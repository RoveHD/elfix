#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <nvsdk_ngx.h>
#include <nvsdk_ngx_helpers_vsr.h>

#include <algorithm>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
constexpr UINT kInputWidth = 640;
constexpr UINT kInputHeight = 360;
constexpr UINT kOutputWidth = 1280;
constexpr UINT kOutputHeight = 720;

bool CheckHr(const char* operation, HRESULT result) {
  if (SUCCEEDED(result)) return true;
  std::cerr << operation << " failed: HRESULT 0x" << std::hex
            << static_cast<unsigned long>(result) << std::dec << '\n';
  return false;
}

bool CheckNgx(const char* operation, NVSDK_NGX_Result result) {
  if (!NVSDK_NGX_FAILED(result)) return true;
  std::cerr << operation << " failed: NGX result 0x" << std::hex
            << static_cast<unsigned>(result) << std::dec << '\n';
  return false;
}

struct NgxSession {
  ID3D11Device* device = nullptr;
  NVSDK_NGX_Parameter* parameters = nullptr;
  NVSDK_NGX_Handle* feature = nullptr;
  bool initialized = false;

  ~NgxSession() {
    if (feature) NVSDK_NGX_D3D11_ReleaseFeature(feature);
    if (initialized) NVSDK_NGX_D3D11_Shutdown1(device);
    if (parameters) NVSDK_NGX_D3D11_DestroyParameters(parameters);
  }
};

int Run() {
  ComPtr<IDXGIFactory1> factory;
  if (!CheckHr("CreateDXGIFactory1", CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return 1;

  ComPtr<IDXGIAdapter1> adapter;
  SIZE_T largestMemory = 0;
  DXGI_ADAPTER_DESC1 chosen = {};
  for (UINT index = 0;; ++index) {
    ComPtr<IDXGIAdapter1> candidate;
    HRESULT result = factory->EnumAdapters1(index, &candidate);
    if (result == DXGI_ERROR_NOT_FOUND) break;
    if (!CheckHr("EnumAdapters1", result)) return 1;
    DXGI_ADAPTER_DESC1 description = {};
    if (!CheckHr("IDXGIAdapter1::GetDesc1", candidate->GetDesc1(&description))) return 1;
    if (description.VendorId != 0x10de || (description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE)) continue;
    if (!adapter || description.DedicatedVideoMemory > largestMemory) {
      adapter = candidate;
      largestMemory = description.DedicatedVideoMemory;
      chosen = description;
    }
  }
  if (!adapter) {
    std::cerr << "No NVIDIA hardware adapter found.\n";
    return 2;
  }
  std::wcout << L"Adapter: " << chosen.Description << L" (" << (largestMemory >> 20)
             << L" MiB dedicated VRAM)\n";

  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  D3D_FEATURE_LEVEL featureLevel = {};
  if (!CheckHr("D3D11CreateDevice", D3D11CreateDevice(
          adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr,
          D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
          &device, &featureLevel, &context))) return 3;
  std::cout << "D3D feature level: 0x" << std::hex
            << static_cast<unsigned>(featureLevel) << std::dec << '\n';

  const auto logDirectory = std::filesystem::temp_directory_path() / L"elfix-rtx-video-probe";
  std::error_code fsError;
  std::filesystem::create_directories(logDirectory, fsError);
  if (fsError) {
    std::cerr << "Cannot create NGX data directory: " << fsError.message() << '\n';
    return 4;
  }

  NgxSession ngx;
  ngx.device = device.Get();
  if (!CheckNgx("NVSDK_NGX_D3D11_Init", NVSDK_NGX_D3D11_Init(
          0, logDirectory.c_str(), device.Get()))) return 5;
  ngx.initialized = true;
  if (!CheckNgx("NVSDK_NGX_D3D11_GetCapabilityParameters",
                NVSDK_NGX_D3D11_GetCapabilityParameters(&ngx.parameters))) return 6;
  if (!ngx.parameters) {
    std::cerr << "NGX returned no capability parameters.\n";
    return 6;
  }
  int available = 0;
  if (!CheckNgx("VSR.Available", ngx.parameters->Get(
          NVSDK_NGX_Parameter_VSR_Available, &available))) return 7;
  std::cout << "VSR.Available: " << available << '\n';
  if (!available) {
    int needsDriver = 0;
    if (!NVSDK_NGX_FAILED(ngx.parameters->Get(
            NVSDK_NGX_Parameter_VSR_NeedsUpdatedDriver, &needsDriver))) {
      std::cout << "VSR.NeedsUpdatedDriver: " << needsDriver << '\n';
    }
    return 8;
  }

  NVSDK_NGX_Feature_Create_Params createParameters = {};
  if (!CheckNgx("NGX_D3D11_CREATE_VSR_EXT", NGX_D3D11_CREATE_VSR_EXT(
          context.Get(), &ngx.feature, ngx.parameters, &createParameters))) return 9;

  std::vector<std::uint8_t> inputPixels(kInputWidth * kInputHeight * 4);
  for (UINT y = 0; y < kInputHeight; ++y) {
    for (UINT x = 0; x < kInputWidth; ++x) {
      const auto offset = (y * kInputWidth + x) * 4;
      inputPixels[offset + 0] = static_cast<std::uint8_t>((x * 255) / (kInputWidth - 1));
      inputPixels[offset + 1] = static_cast<std::uint8_t>((y * 255) / (kInputHeight - 1));
      inputPixels[offset + 2] = ((x / 20 + y / 20) & 1) ? 224 : 32;
      inputPixels[offset + 3] = 255;
    }
  }
  D3D11_TEXTURE2D_DESC inputDescription = {};
  inputDescription.Width = kInputWidth;
  inputDescription.Height = kInputHeight;
  inputDescription.MipLevels = 1;
  inputDescription.ArraySize = 1;
  inputDescription.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  inputDescription.SampleDesc.Count = 1;
  inputDescription.Usage = D3D11_USAGE_DEFAULT;
  inputDescription.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  D3D11_SUBRESOURCE_DATA inputData = {};
  inputData.pSysMem = inputPixels.data();
  inputData.SysMemPitch = kInputWidth * 4;
  ComPtr<ID3D11Texture2D> input;
  if (!CheckHr("CreateTexture2D(input)", device->CreateTexture2D(
          &inputDescription, &inputData, &input))) return 10;

  D3D11_TEXTURE2D_DESC outputDescription = inputDescription;
  outputDescription.Width = kOutputWidth;
  outputDescription.Height = kOutputHeight;
  outputDescription.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_UNORDERED_ACCESS;
  ComPtr<ID3D11Texture2D> output;
  if (!CheckHr("CreateTexture2D(output)", device->CreateTexture2D(
          &outputDescription, nullptr, &output))) return 11;

  NVSDK_NGX_D3D11_VSR_Eval_Params evaluation = {};
  evaluation.pInput = input.Get();
  evaluation.pOutput = output.Get();
  evaluation.InputSubrectSize = {kInputWidth, kInputHeight};
  evaluation.OutputSubrectSize = {kOutputWidth, kOutputHeight};
  evaluation.QualityLevel = NVSDK_NGX_VSR_Quality_Medium;
  if (!CheckNgx("NGX_D3D11_EVALUATE_VSR_EXT", NGX_D3D11_EVALUATE_VSR_EXT(
          context.Get(), ngx.feature, ngx.parameters, &evaluation))) return 12;

  D3D11_TEXTURE2D_DESC stagingDescription = outputDescription;
  stagingDescription.Usage = D3D11_USAGE_STAGING;
  stagingDescription.BindFlags = 0;
  stagingDescription.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  ComPtr<ID3D11Texture2D> staging;
  if (!CheckHr("CreateTexture2D(staging)", device->CreateTexture2D(
          &stagingDescription, nullptr, &staging))) return 13;
  context->CopyResource(staging.Get(), output.Get());
  D3D11_MAPPED_SUBRESOURCE mapped = {};
  if (!CheckHr("Map(staging)", context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return 14;

  std::uint64_t checksum = 14695981039346656037ull;
  std::uint64_t leftRed = 0;
  std::uint64_t rightRed = 0;
  std::uint64_t nonblack = 0;
  for (UINT y = 0; y < kOutputHeight; ++y) {
    const auto* row = static_cast<const std::uint8_t*>(mapped.pData) + y * mapped.RowPitch;
    for (UINT x = 0; x < kOutputWidth; ++x) {
      const auto* pixel = row + x * 4;
      for (int channel = 0; channel < 4; ++channel) {
        checksum = (checksum ^ pixel[channel]) * 1099511628211ull;
      }
      (x < kOutputWidth / 2 ? leftRed : rightRed) += pixel[0];
      nonblack += (pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0);
    }
  }
  context->Unmap(staging.Get(), 0);
  std::cout << "Output " << kOutputWidth << 'x' << kOutputHeight
            << ", nonblack pixels " << nonblack << '/' << (kOutputWidth * kOutputHeight)
            << ", left/right red sums " << leftRed << '/' << rightRed
            << ", FNV64 0x" << std::hex << checksum << std::dec << '\n';
  if (nonblack < (kOutputWidth * kOutputHeight) / 4 || rightRed <= leftRed) {
    std::cerr << "VSR returned success, but output failed the pattern sanity check.\n";
    return 15;
  }
  std::cout << "PASS: NGX VSR produced a nontrivial 2x output frame.\n";
  return 0;
}
}  // namespace

int main() {
  try {
    return Run();
  } catch (const std::exception& error) {
    std::cerr << "Probe exception: " << error.what() << '\n';
    return 16;
  }
}
