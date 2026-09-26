#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <fcntl.h>
#include <io.h>

#include <nvsdk_ngx.h>
#include <nvsdk_ngx_helpers_vsr.h>

#include <cstdint>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
constexpr uint32_t kMagic = 0x58545245;  // "ERTX", little endian
constexpr uint32_t kFrame = 1;
constexpr uint32_t kCloseHandle = 2;
constexpr uint32_t kReleaseFrame = 3;
constexpr uint32_t kStop = 4;
constexpr uint32_t kMaxWidth = 3840;
constexpr uint32_t kMaxHeight = 2160;
constexpr uint32_t kMaxBytes = 32 * 1024 * 1024;

struct Header {
  uint32_t magic, operation, generation, frameId;
  uint32_t width, height, outputWidth, outputHeight;
  uint32_t quality, byteLength;
};
static_assert(sizeof(Header) == 40, "Wire header must be 40 bytes");

void Error(const char* code) {
  std::cout << "{\"type\":\"error\",\"code\":\"" << code << "\"}" << std::endl;
}

bool GoodDimensions(const Header& h) {
  const uint64_t bytes = uint64_t(h.width) * h.height * 4;
  return h.generation > 0 && h.frameId > 0 && h.width >= 640 && h.height >= 360 &&
         h.width <= kMaxWidth && h.height <= kMaxHeight &&
         h.outputWidth >= h.width && h.outputHeight >= h.height &&
         h.outputWidth <= kMaxWidth && h.outputHeight <= kMaxHeight &&
         h.quality >= 1 && h.quality <= 4 && bytes <= kMaxBytes &&
         bytes == h.byteLength;
}

struct Session {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  NVSDK_NGX_Parameter* parameters = nullptr;
  NVSDK_NGX_Handle* feature = nullptr;
  bool initialized = false;
  HANDLE parent = nullptr;
  ComPtr<ID3D11Texture2D> output;
  ComPtr<ID3D11Texture2D> shared;
  HANDLE localHandle = nullptr;
  HANDLE remoteHandle = nullptr;
  uint32_t generation = 0;
  uint32_t frameId = 0;

  bool CloseRemoteHandle() {
    if (!remoteHandle) return true;
    HANDLE duplicate = nullptr;
    // The parent never closes this original handle. Electron synchronously
    // duplicates it on import; only this helper closes its own remote copy.
    const BOOL ok = DuplicateHandle(parent, remoteHandle, GetCurrentProcess(),
                                    &duplicate, 0, FALSE,
                                    DUPLICATE_SAME_ACCESS | DUPLICATE_CLOSE_SOURCE);
    remoteHandle = nullptr;
    if (duplicate) CloseHandle(duplicate);
    return ok != FALSE;
  }

  void ReleaseFrame() {
    CloseRemoteHandle();
    if (localHandle) CloseHandle(localHandle);
    localHandle = nullptr;
    shared.Reset();
    output.Reset();
    frameId = generation = 0;
  }

  ~Session() {
    ReleaseFrame();
    if (feature) NVSDK_NGX_D3D11_ReleaseFeature(feature);
    if (initialized) NVSDK_NGX_D3D11_Shutdown1(device.Get());
    if (parameters) NVSDK_NGX_D3D11_DestroyParameters(parameters);
    if (parent) CloseHandle(parent);
  }
};

bool Init(Session& s, DWORD parentPid, const wchar_t* dataDirectory) {
  s.parent = OpenProcess(PROCESS_DUP_HANDLE, FALSE, parentPid);
  if (!s.parent) { Error("parent_process"); return false; }
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) { Error("dxgi_factory"); return false; }
  ComPtr<IDXGIAdapter1> chosen;
  SIZE_T mostMemory = 0;
  for (UINT index = 0;; ++index) {
    ComPtr<IDXGIAdapter1> adapter;
    const HRESULT result = factory->EnumAdapters1(index, &adapter);
    if (result == DXGI_ERROR_NOT_FOUND) break;
    if (FAILED(result)) { Error("dxgi_adapter"); return false; }
    DXGI_ADAPTER_DESC1 description = {};
    if (FAILED(adapter->GetDesc1(&description))) { Error("dxgi_adapter"); return false; }
    if (description.VendorId == 0x10de && !(description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) &&
        (!chosen || description.DedicatedVideoMemory > mostMemory)) {
      chosen = adapter;
      mostMemory = description.DedicatedVideoMemory;
    }
  }
  if (!chosen) { Error("no_rtx_adapter"); return false; }
  D3D_FEATURE_LEVEL level = {};
  if (FAILED(D3D11CreateDevice(chosen.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
                               D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0,
                               D3D11_SDK_VERSION, &s.device, &level, &s.context))) {
    Error("d3d_device"); return false;
  }
  std::error_code pathError;
  std::filesystem::create_directories(dataDirectory, pathError);
  if (pathError) { Error("data_directory"); return false; }
  if (NVSDK_NGX_FAILED(NVSDK_NGX_D3D11_Init(0, dataDirectory, s.device.Get()))) {
    Error("ngx_init"); return false;
  }
  s.initialized = true;
  if (NVSDK_NGX_FAILED(NVSDK_NGX_D3D11_GetCapabilityParameters(&s.parameters)) ||
      !s.parameters) { Error("ngx_capabilities"); return false; }
  int available = 0;
  if (NVSDK_NGX_FAILED(s.parameters->Get(NVSDK_NGX_Parameter_VSR_Available, &available)) ||
      !available) { Error("vsr_unavailable"); return false; }
  NVSDK_NGX_Feature_Create_Params create = {};
  if (NVSDK_NGX_FAILED(NGX_D3D11_CREATE_VSR_EXT(s.context.Get(), &s.feature,
                                                s.parameters, &create))) {
    Error("vsr_create"); return false;
  }
  std::cout << "{\"type\":\"ready\"}" << std::endl;
  return true;
}

bool WaitForGpu(Session& s) {
  D3D11_QUERY_DESC description = {};
  description.Query = D3D11_QUERY_EVENT;
  ComPtr<ID3D11Query> query;
  if (FAILED(s.device->CreateQuery(&description, &query))) return false;
  s.context->End(query.Get());
  s.context->Flush();
  const ULONGLONG deadline = GetTickCount64() + 5000;
  while (GetTickCount64() < deadline) {
    const HRESULT result = s.context->GetData(query.Get(), nullptr, 0, 0);
    if (result == S_OK) return true;
    if (FAILED(result)) return false;
    Sleep(1);
  }
  return false;
}

bool ProcessFrame(Session& s, const Header& h) {
  if (!GoodDimensions(h) || s.frameId != 0) { Error("invalid_frame"); return false; }
  std::vector<uint8_t> pixels(h.byteLength);
  if (!std::cin.read(reinterpret_cast<char*>(pixels.data()), pixels.size())) {
    Error("truncated_pixels"); return false;
  }
  D3D11_TEXTURE2D_DESC sourceDesc = {};
  sourceDesc.Width = h.width;
  sourceDesc.Height = h.height;
  sourceDesc.MipLevels = sourceDesc.ArraySize = sourceDesc.SampleDesc.Count = 1;
  sourceDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  sourceDesc.Usage = D3D11_USAGE_DEFAULT;
  sourceDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  D3D11_SUBRESOURCE_DATA sourceData = {};
  sourceData.pSysMem = pixels.data();
  sourceData.SysMemPitch = h.width * 4;
  ComPtr<ID3D11Texture2D> input;
  if (FAILED(s.device->CreateTexture2D(&sourceDesc, &sourceData, &input))) {
    Error("input_texture"); return false;
  }
  D3D11_TEXTURE2D_DESC outputDesc = sourceDesc;
  outputDesc.Width = h.outputWidth;
  outputDesc.Height = h.outputHeight;
  outputDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_UNORDERED_ACCESS;
  if (FAILED(s.device->CreateTexture2D(&outputDesc, nullptr, &s.output))) {
    Error("output_texture"); return false;
  }
  NVSDK_NGX_D3D11_VSR_Eval_Params evaluation = {};
  evaluation.pInput = input.Get();
  evaluation.pOutput = s.output.Get();
  evaluation.InputSubrectSize = {h.width, h.height};
  evaluation.OutputSubrectSize = {h.outputWidth, h.outputHeight};
  evaluation.QualityLevel = static_cast<NVSDK_NGX_VSR_QualityLevel>(h.quality);
  if (NVSDK_NGX_FAILED(NGX_D3D11_EVALUATE_VSR_EXT(s.context.Get(), s.feature,
                                                   s.parameters, &evaluation))) {
    Error("vsr_evaluate"); return false;
  }
  D3D11_TEXTURE2D_DESC sharedDesc = outputDesc;
  sharedDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  sharedDesc.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  if (FAILED(s.device->CreateTexture2D(&sharedDesc, nullptr, &s.shared))) {
    Error("shared_texture"); return false;
  }
  s.context->CopyResource(s.shared.Get(), s.output.Get());
  if (!WaitForGpu(s)) { Error("gpu_timeout"); return false; }
  ComPtr<IDXGIResource1> dxgiResource;
  if (FAILED(s.shared.As(&dxgiResource)) ||
      FAILED(dxgiResource->CreateSharedHandle(nullptr,
          DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE,
          nullptr, &s.localHandle))) {
    Error("shared_handle"); return false;
  }
  if (!DuplicateHandle(GetCurrentProcess(), s.localHandle, s.parent,
                       &s.remoteHandle, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
    Error("handle_duplicate"); return false;
  }
  s.generation = h.generation;
  s.frameId = h.frameId;
  std::cout << "{\"type\":\"frame\",\"generation\":" << h.generation
            << ",\"frameId\":" << h.frameId << ",\"width\":" << h.outputWidth
            << ",\"height\":" << h.outputHeight << ",\"handle\":\""
            << std::hex << reinterpret_cast<uintptr_t>(s.remoteHandle)
            << std::dec << "\"}" << std::endl;
  return true;
}
}  // namespace

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdin), _O_BINARY);
  if (argc != 3) { Error("arguments"); return 2; }
  wchar_t* end = nullptr;
  const unsigned long pid = wcstoul(argv[1], &end, 10);
  if (end == argv[1] || *end || pid == 0) { Error("parent_pid"); return 2; }
  Session session;
  if (!Init(session, static_cast<DWORD>(pid), argv[2])) return 3;
  Header header = {};
  while (std::cin.read(reinterpret_cast<char*>(&header), sizeof(header))) {
    if (header.magic != kMagic) { Error("protocol"); return 4; }
    if (header.operation == kStop) return 0;
    if (header.operation == kFrame) {
      if (!ProcessFrame(session, header)) return 5;
    } else if (header.operation == kCloseHandle &&
               header.generation == session.generation &&
               header.frameId == session.frameId) {
      if (!session.CloseRemoteHandle()) { Error("handle_close"); return 6; }
    } else if (header.operation == kReleaseFrame &&
               header.generation == session.generation &&
               header.frameId == session.frameId) {
      session.ReleaseFrame();
      std::cout << "{\"type\":\"released\",\"generation\":" << header.generation
                << ",\"frameId\":" << header.frameId << "}" << std::endl;
    } else {
      Error("protocol_state"); return 7;
    }
    header = {};
  }
  return 0;
}
