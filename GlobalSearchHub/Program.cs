using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Text.Json;
using System.Web;

namespace GlobalSearchHub;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new HubForm());
    }
}

public sealed class SearchProvider
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Template { get; set; } = "";
    public string HomeUrl { get; set; } = "";
    public string Logo { get; set; } = "";
    public bool IsEnabled { get; set; } = true;
}

public sealed class HubForm : Form
{
    private static readonly string AppFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "GlobalSearchHub");

    private static readonly string ProviderFile = Path.Combine(AppFolder, "providers.json");

    private readonly List<SearchProvider> providers;
    private readonly Dictionary<Guid, WebBrowser> browsers = [];
    private readonly TextBox searchBox = new();
    private readonly FlowLayoutPanel providerRail = new();
    private readonly FlowLayoutPanel recentRail = new();
    private readonly Panel contentHost = new();
    private readonly RoundPanel startView = new();
    private readonly Label heroTitle = new();
    private readonly Label heroSubtitle = new();
    private readonly Label browserTitle = new();
    private readonly Panel browserToolbar = new();
    private Guid? activeProviderId;

    public HubForm()
    {
        providers = LoadProviders();
        activeProviderId = EnabledProviders().FirstOrDefault()?.Id;

        Text = "Streaming Browser";
        Width = 1540;
        Height = 940;
        MinimumSize = new Size(1120, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Page;
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);

        BuildUi();
        Render();
        ShowStartView();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 4,
            ColumnCount = 1,
            BackColor = Ui.Page,
            Padding = new Padding(22, 14, 22, 20)
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 122));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(root);

        root.Controls.Add(BuildTopBar(), 0, 0);
        root.Controls.Add(BuildProviderRailSection(), 0, 1);
        root.Controls.Add(BuildBrowserBar(), 0, 2);

        contentHost.Dock = DockStyle.Fill;
        contentHost.BackColor = Ui.Page;
        root.Controls.Add(contentHost, 0, 3);
    }

    private Control BuildTopBar()
    {
        var top = new RoundPanel
        {
            Dock = DockStyle.Fill,
            Radius = 18,
            StartColor = Color.FromArgb(28, 34, 43),
            EndColor = Color.FromArgb(18, 23, 31),
            Padding = new Padding(20, 8, 18, 8),
            Glow = false
        };

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 8,
            RowCount = 1,
            BackColor = Color.Transparent
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 116));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
        top.Controls.Add(grid);

        grid.Controls.Add(new Label
        {
            Text = "stream.",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 24, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft,
            BackColor = Color.Transparent
        }, 0, 0);

        var startButton = MakeNavButton("Start", true);
        startButton.Click += (_, _) => ShowStartView();
        grid.Controls.Add(startButton, 1, 0);

        var searchButton = MakeNavButton("Suche", false);
        searchButton.Click += (_, _) => ShowActiveSearch();
        grid.Controls.Add(searchButton, 2, 0);

        var favoritesButton = MakeNavButton("Favoriten", false);
        favoritesButton.Click += (_, _) => MessageBox.Show("Favoriten sind fuer spaeter vorbereitet.", "Favoriten", MessageBoxButtons.OK, MessageBoxIcon.Information);
        grid.Controls.Add(favoritesButton, 3, 0);

        searchBox.Dock = DockStyle.Fill;
        searchBox.PlaceholderText = "Titel oder Website durchsuchen";
        searchBox.Font = new Font("Segoe UI", 13);
        searchBox.BackColor = Color.FromArgb(12, 16, 23);
        searchBox.ForeColor = Color.White;
        searchBox.BorderStyle = BorderStyle.FixedSingle;
        searchBox.Margin = new Padding(12, 7, 12, 7);
        searchBox.KeyDown += (_, args) =>
        {
            if (args.KeyCode == Keys.Enter)
            {
                args.SuppressKeyPress = true;
                ShowActiveSearch();
            }
        };
        grid.Controls.Add(searchBox, 4, 0);

        var backButton = MakeIconButton("<");
        backButton.Click += (_, _) => CurrentBrowser()?.GoBack();
        grid.Controls.Add(backButton, 5, 0);

        var reloadButton = MakeIconButton("R");
        reloadButton.Click += (_, _) => CurrentBrowser()?.Refresh();
        grid.Controls.Add(reloadButton, 6, 0);

        var settingsButton = MakeNavButton("Settings", false);
        settingsButton.Click += (_, _) => OpenSettings();
        grid.Controls.Add(settingsButton, 7, 0);

        return top;
    }

    private Control BuildProviderRailSection()
    {
        var wrap = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
            BackColor = Ui.Page,
            Padding = new Padding(0, 18, 0, 0)
        };
        wrap.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        wrap.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        wrap.Controls.Add(new Label
        {
            Text = "Streaming-Anbieter",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        }, 0, 0);

        providerRail.Dock = DockStyle.Fill;
        providerRail.FlowDirection = FlowDirection.LeftToRight;
        providerRail.WrapContents = false;
        providerRail.AutoScroll = true;
        providerRail.BackColor = Ui.Page;
        wrap.Controls.Add(providerRail, 0, 1);

        return wrap;
    }

    private Control BuildBrowserBar()
    {
        browserToolbar.Dock = DockStyle.Fill;
        browserToolbar.BackColor = Ui.Page;

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 4,
            RowCount = 1,
            BackColor = Ui.Page
        };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        browserToolbar.Controls.Add(grid);

        browserTitle.Dock = DockStyle.Fill;
        browserTitle.ForeColor = Color.White;
        browserTitle.Font = new Font("Segoe UI", 12, FontStyle.Bold);
        browserTitle.TextAlign = ContentAlignment.MiddleLeft;
        grid.Controls.Add(browserTitle, 0, 0);

        var homeButton = MakeSoftButton("Startseite");
        homeButton.Click += (_, _) => ShowActiveHome();
        grid.Controls.Add(homeButton, 1, 0);

        var forwardButton = MakeSoftButton("Vor");
        forwardButton.Click += (_, _) => CurrentBrowser()?.GoForward();
        grid.Controls.Add(forwardButton, 2, 0);

        var externalButton = MakeSoftButton("Browser");
        externalButton.Click += (_, _) => OpenCurrentExternal();
        grid.Controls.Add(externalButton, 3, 0);

        return browserToolbar;
    }

    private void BuildStartView()
    {
        startView.Controls.Clear();
        startView.Dock = DockStyle.Fill;
        startView.Radius = 22;
        startView.StartColor = Color.FromArgb(20, 26, 38);
        startView.EndColor = Color.FromArgb(8, 12, 18);
        startView.Padding = new Padding(34, 28, 34, 28);
        startView.Glow = true;

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 5,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 66));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 144));
        startView.Controls.Add(grid);

        heroTitle.Text = ActiveProvider()?.Name ?? "Streaming Browser";
        heroTitle.Dock = DockStyle.Fill;
        heroTitle.ForeColor = Color.White;
        heroTitle.Font = new Font("Segoe UI", 34, FontStyle.Bold);
        heroTitle.TextAlign = ContentAlignment.BottomLeft;
        heroTitle.BackColor = Color.Transparent;
        grid.Controls.Add(heroTitle, 0, 1);

        heroSubtitle.Text = ActiveProvider() is null
            ? "Fuege deine Websites in Settings hinzu und oeffne sie direkt hier."
            : "Waehle einen Anbieter und benutze die Website direkt in der App.";
        heroSubtitle.Dock = DockStyle.Fill;
        heroSubtitle.ForeColor = Color.FromArgb(220, 226, 236);
        heroSubtitle.Font = new Font("Segoe UI", 11, FontStyle.Bold);
        heroSubtitle.BackColor = Color.Transparent;
        grid.Controls.Add(heroSubtitle, 0, 2);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent
        };
        var watch = MakeActionButton("Jetzt ansehen", Color.FromArgb(238, 238, 238), Color.FromArgb(12, 16, 23));
        watch.Width = 166;
        watch.Click += (_, _) => ShowActiveHome();
        actions.Controls.Add(watch);

        var add = MakeActionButton("+ Anbieter", Color.FromArgb(46, 54, 68), Color.White);
        add.Width = 140;
        add.Click += (_, _) => OpenSettings();
        actions.Controls.Add(add);
        grid.Controls.Add(actions, 0, 3);

        var recentWrap = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        recentWrap.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        recentWrap.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        recentWrap.Controls.Add(new Label
        {
            Text = "Zuletzt / Anbieter",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 14, FontStyle.Bold),
            BackColor = Color.Transparent
        }, 0, 0);

        recentRail.Dock = DockStyle.Fill;
        recentRail.FlowDirection = FlowDirection.LeftToRight;
        recentRail.WrapContents = false;
        recentRail.AutoScroll = true;
        recentRail.BackColor = Color.Transparent;
        recentWrap.Controls.Add(recentRail, 0, 1);
        grid.Controls.Add(recentWrap, 0, 4);
    }

    private void Render()
    {
        RenderProviderRail();
        BuildStartView();
        RenderRecentRail();

        var active = ActiveProvider();
        browserTitle.Text = active is null ? "Keine Website geoeffnet" : $"Aktuell: {active.Name}";
    }

    private void RenderProviderRail()
    {
        providerRail.SuspendLayout();
        providerRail.Controls.Clear();

        foreach (var provider in EnabledProviders())
        {
            providerRail.Controls.Add(MakeProviderCard(provider, wide: false));
        }

        if (!EnabledProviders().Any())
        {
            providerRail.Controls.Add(MakeEmptyLabel("Keine aktiven Anbieter. Oeffne Settings, um Websites hinzuzufuegen."));
        }

        providerRail.ResumeLayout();
    }

    private void RenderRecentRail()
    {
        recentRail.SuspendLayout();
        recentRail.Controls.Clear();

        foreach (var provider in EnabledProviders())
        {
            recentRail.Controls.Add(MakeProviderCard(provider, wide: true));
        }

        if (!EnabledProviders().Any())
        {
            recentRail.Controls.Add(MakeEmptyLabel("Settings oeffnen und erste Website speichern."));
        }

        recentRail.ResumeLayout();
    }

    private Control MakeProviderCard(SearchProvider provider, bool wide)
    {
        var active = provider.Id == activeProviderId;
        var card = new RoundPanel
        {
            Width = wide ? 235 : 190,
            Height = wide ? 94 : 72,
            Radius = 20,
            Margin = new Padding(0, 0, 16, 12),
            Padding = new Padding(16),
            StartColor = active ? Color.FromArgb(194, 24, 37) : Color.FromArgb(30, 37, 49),
            EndColor = active ? Color.FromArgb(92, 13, 24) : Color.FromArgb(18, 23, 31),
            Cursor = Cursors.Hand,
            Glow = active
        };
        card.Click += (_, _) => ShowProviderHome(provider);
        card.MouseEnter += (_, _) => card.ScaleTo(active ? 1.04f : 1.03f);
        card.MouseLeave += (_, _) => card.ScaleTo(1f);

        var logo = new Label
        {
            Text = ProviderLogo(provider),
            Dock = DockStyle.Left,
            Width = wide ? 62 : 48,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", wide ? 22 : 18, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleCenter,
            BackColor = Color.Transparent
        };
        logo.Click += (_, _) => ShowProviderHome(provider);
        card.Controls.Add(logo);

        var textStack = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
            BackColor = Color.Transparent,
            Padding = new Padding(8, 4, 0, 0)
        };
        textStack.RowStyles.Add(new RowStyle(SizeType.Percent, 58));
        textStack.RowStyles.Add(new RowStyle(SizeType.Percent, 42));
        card.Controls.Add(textStack);
        textStack.BringToFront();

        var name = new Label
        {
            Text = provider.Name,
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", wide ? 13 : 11, FontStyle.Bold),
            TextAlign = ContentAlignment.BottomLeft,
            BackColor = Color.Transparent
        };
        name.Click += (_, _) => ShowProviderHome(provider);
        textStack.Controls.Add(name, 0, 0);

        var host = new Label
        {
            Text = HostFromUrl(provider.HomeUrl),
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(210, 216, 226),
            Font = new Font("Segoe UI", 8),
            TextAlign = ContentAlignment.TopLeft,
            BackColor = Color.Transparent
        };
        host.Click += (_, _) => ShowProviderHome(provider);
        textStack.Controls.Add(host, 0, 1);

        return card;
    }

    private void OpenSettings()
    {
        using var settings = new SettingsForm(providers);
        if (settings.ShowDialog(this) == DialogResult.OK)
        {
            SaveProviders();
            activeProviderId = EnabledProviders().FirstOrDefault(provider => provider.Id == activeProviderId)?.Id
                ?? EnabledProviders().FirstOrDefault()?.Id;
            Render();
            ShowStartView();
        }
    }

    private void ShowStartView()
    {
        contentHost.Controls.Clear();
        Render();
        contentHost.Controls.Add(startView);
        browserTitle.Text = "Startseite";
    }

    private void ShowActiveHome()
    {
        var provider = ActiveProvider();
        if (provider is null)
        {
            OpenSettings();
            return;
        }

        ShowProviderHome(provider);
    }

    private void ShowProviderHome(SearchProvider provider)
    {
        if (!provider.IsEnabled || !IsHttpUrl(provider.HomeUrl))
        {
            return;
        }

        activeProviderId = provider.Id;
        NavigateProvider(provider, provider.HomeUrl);
    }

    private void ShowActiveSearch()
    {
        var provider = ActiveProvider();
        if (provider is null)
        {
            OpenSettings();
            return;
        }

        var query = searchBox.Text.Trim();
        if (query.Length == 0)
        {
            ShowProviderHome(provider);
            return;
        }

        NavigateProvider(provider, BuildSearchUrl(provider, query));
    }

    private void NavigateProvider(SearchProvider provider, string url)
    {
        activeProviderId = provider.Id;
        RenderProviderRail();
        RenderRecentRail();
        browserTitle.Text = $"Aktuell: {provider.Name}";

        var browser = GetBrowser(provider);
        contentHost.Controls.Clear();
        contentHost.Controls.Add(browser);

        if (IsHttpUrl(url) && browser.Url?.AbsoluteUri != url)
        {
            browser.Navigate(url);
        }
    }

    private WebBrowser GetBrowser(SearchProvider provider)
    {
        if (browsers.TryGetValue(provider.Id, out var existing))
        {
            return existing;
        }

        var created = new WebBrowser
        {
            Dock = DockStyle.Fill,
            ScriptErrorsSuppressed = true,
            AllowWebBrowserDrop = false,
            IsWebBrowserContextMenuEnabled = true
        };
        browsers[provider.Id] = created;
        return created;
    }

    private WebBrowser? CurrentBrowser()
    {
        return activeProviderId is { } id && browsers.TryGetValue(id, out var browser) ? browser : null;
    }

    private void OpenCurrentExternal()
    {
        var browser = CurrentBrowser();
        if (browser?.Url is null)
        {
            var provider = ActiveProvider();
            if (provider is not null)
            {
                OpenUrl(provider.HomeUrl);
            }
            return;
        }

        OpenUrl(browser.Url.AbsoluteUri);
    }

    private IEnumerable<SearchProvider> EnabledProviders()
    {
        return providers.Where(provider => provider.IsEnabled);
    }

    private SearchProvider? ActiveProvider()
    {
        return EnabledProviders().FirstOrDefault(provider => provider.Id == activeProviderId)
            ?? EnabledProviders().FirstOrDefault();
    }

    private static string ProviderLogo(SearchProvider provider)
    {
        if (!string.IsNullOrWhiteSpace(provider.Logo))
        {
            return provider.Logo.Trim();
        }

        var clean = provider.Name.Trim();
        return clean.Length == 0 ? "?" : clean[..Math.Min(clean.Length, 2)].ToUpperInvariant();
    }

    private static string BuildSearchUrl(SearchProvider provider, string query)
    {
        return provider.Template.Replace("{query}", HttpUtility.UrlEncode(query), StringComparison.Ordinal);
    }

    private void SaveProviders()
    {
        Directory.CreateDirectory(AppFolder);
        var options = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(ProviderFile, JsonSerializer.Serialize(providers, options));
    }

    private static List<SearchProvider> LoadProviders()
    {
        try
        {
            if (File.Exists(ProviderFile))
            {
                var saved = JsonSerializer.Deserialize<List<SearchProvider>>(File.ReadAllText(ProviderFile));
                if (saved is { Count: > 0 })
                {
                    foreach (var provider in saved)
                    {
                        NormalizeProvider(provider);
                    }

                    return saved.Where(IsValidProvider).ToList();
                }
            }
        }
        catch
        {
            // Broken settings should not prevent the app from starting.
        }

        return DefaultProviders();
    }

    private static List<SearchProvider> DefaultProviders()
    {
        return
        [
            new SearchProvider
            {
                Name = "IMDb",
                Logo = "IM",
                Template = "https://www.imdb.com/find/?q={query}",
                HomeUrl = "https://www.imdb.com",
                IsEnabled = true
            },
            new SearchProvider
            {
                Name = "TMDb",
                Logo = "TM",
                Template = "https://www.themoviedb.org/search?query={query}",
                HomeUrl = "https://www.themoviedb.org",
                IsEnabled = true
            },
            new SearchProvider
            {
                Name = "JustWatch",
                Logo = "JW",
                Template = "https://www.justwatch.com/de/Suche?q={query}",
                HomeUrl = "https://www.justwatch.com/de",
                IsEnabled = true
            }
        ];
    }

    internal static bool TryBuildProvider(string rawNameOrUrl, string rawHome, string rawTemplate, string rawLogo, bool enabled, out SearchProvider provider, out string error)
    {
        provider = new SearchProvider();
        error = "";

        var nameOrUrl = rawNameOrUrl.Trim();
        var home = rawHome.Trim();
        var template = rawTemplate.Trim();

        if (nameOrUrl.Length == 0)
        {
            error = "Trag einen Namen oder eine Website ein.";
            return false;
        }

        if (home.Length == 0 && LooksLikeUrl(nameOrUrl))
        {
            home = NormalizeUrl(nameOrUrl);
        }
        else if (home.Length > 0)
        {
            home = NormalizeUrl(home);
        }

        if (home.Length == 0 || !IsHttpUrl(home))
        {
            error = "Die Website muss eine gueltige http/https-Adresse sein.";
            return false;
        }

        if (template.Length == 0)
        {
            template = BuildSiteSearchTemplate(home);
        }
        else
        {
            template = NormalizeUrl(template);
            if (!HasHttpPrefix(template))
            {
                error = "Die Such-URL muss mit http/https starten.";
                return false;
            }

            if (!template.Contains("{query}", StringComparison.Ordinal))
            {
                template = BuildSiteSearchTemplate(template);
            }
        }

        if (template.Length == 0)
        {
            error = "Die Such-URL konnte nicht erzeugt werden.";
            return false;
        }

        provider = new SearchProvider
        {
            Name = LooksLikeUrl(nameOrUrl) ? HostFromUrl(nameOrUrl) : nameOrUrl,
            HomeUrl = home,
            Template = template,
            Logo = rawLogo.Trim(),
            IsEnabled = enabled
        };
        return true;
    }

    internal static void NormalizeProvider(SearchProvider provider)
    {
        provider.Name = provider.Name.Trim();
        provider.HomeUrl = NormalizeUrl(provider.HomeUrl.Length > 0 ? provider.HomeUrl : ExtractHome(provider.Template));
        provider.Template = provider.Template.Trim();

        if (provider.Template.Length == 0 || !provider.Template.Contains("{query}", StringComparison.Ordinal))
        {
            provider.Template = BuildSiteSearchTemplate(provider.HomeUrl.Length > 0 ? provider.HomeUrl : provider.Template);
        }

        if (provider.Logo is null)
        {
            provider.Logo = "";
        }
    }

    internal static bool IsValidProvider(SearchProvider provider)
    {
        return provider.Name.Trim().Length > 0
            && IsHttpUrl(provider.HomeUrl)
            && HasHttpPrefix(provider.Template)
            && provider.Template.Contains("{query}", StringComparison.Ordinal);
    }

    internal static bool LooksLikeUrl(string value)
    {
        return value.Contains('.') || value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    internal static string NormalizeUrl(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length == 0)
        {
            return "";
        }

        if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return "https://" + trimmed;
        }

        return trimmed;
    }

    internal static string BuildSiteSearchTemplate(string url)
    {
        var normalized = NormalizeUrl(url);
        return Uri.TryCreate(normalized, UriKind.Absolute, out var uri)
            ? $"https://www.google.com/search?q=site%3A{uri.Host}+{{query}}"
            : "";
    }

    internal static bool HasHttpPrefix(string url)
    {
        return url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsHttpUrl(string url)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    internal static string ExtractHome(string template)
    {
        var previewUrl = template.Replace("{query}", "test", StringComparison.Ordinal);
        return Uri.TryCreate(previewUrl, UriKind.Absolute, out var uri)
            ? $"{uri.Scheme}://{uri.Host}"
            : "";
    }

    internal static string HostFromUrl(string url)
    {
        var normalized = NormalizeUrl(url);
        return Uri.TryCreate(normalized, UriKind.Absolute, out var uri) ? uri.Host : url;
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private static RoundButton MakeNavButton(string text, bool selected)
    {
        return new RoundButton
        {
            Text = text,
            Dock = DockStyle.Fill,
            Radius = 13,
            Margin = new Padding(4, 5, 4, 5),
            NormalColor = selected ? Color.FromArgb(82, 90, 101) : Color.Transparent,
            HoverColor = Color.FromArgb(72, 81, 94),
            TextColor = Color.White,
            Font = new Font("Segoe UI", 10, FontStyle.Bold)
        };
    }

    private static RoundButton MakeIconButton(string text)
    {
        return new RoundButton
        {
            Text = text,
            Dock = DockStyle.Fill,
            Radius = 17,
            Margin = new Padding(4, 7, 4, 7),
            NormalColor = Color.FromArgb(34, 42, 55),
            HoverColor = Color.FromArgb(59, 70, 88),
            TextColor = Color.White,
            Font = new Font("Segoe UI", 10, FontStyle.Bold)
        };
    }

    private static RoundButton MakeSoftButton(string text)
    {
        return new RoundButton
        {
            Text = text,
            Dock = DockStyle.Fill,
            Radius = 14,
            Margin = new Padding(8, 7, 0, 7),
            NormalColor = Color.FromArgb(28, 35, 47),
            HoverColor = Color.FromArgb(48, 58, 74),
            TextColor = Color.White,
            Font = new Font("Segoe UI", 9, FontStyle.Bold)
        };
    }

    private static RoundButton MakeActionButton(string text, Color background, Color textColor)
    {
        return new RoundButton
        {
            Text = text,
            Width = 150,
            Height = 48,
            Radius = 14,
            Margin = new Padding(0, 8, 12, 8),
            NormalColor = background,
            HoverColor = ControlPaint.Light(background, 0.15f),
            TextColor = textColor,
            Font = new Font("Segoe UI", 10, FontStyle.Bold)
        };
    }

    private static Label MakeEmptyLabel(string text)
    {
        return new Label
        {
            Text = text,
            Width = 520,
            Height = 56,
            ForeColor = Ui.Muted,
            Font = new Font("Segoe UI", 11),
            TextAlign = ContentAlignment.MiddleLeft,
            BackColor = Color.Transparent
        };
    }
}

public sealed class SettingsForm : Form
{
    private readonly List<SearchProvider> providers;
    private readonly ListBox providerList = new();
    private readonly TextBox nameBox = new();
    private readonly TextBox websiteBox = new();
    private readonly TextBox searchTemplateBox = new();
    private readonly TextBox logoBox = new();
    private readonly CheckBox enabledBox = new();
    private bool changed;

    public SettingsForm(List<SearchProvider> providers)
    {
        this.providers = providers;

        Text = "Settings - Streaming-Anbieter";
        Width = 920;
        Height = 620;
        MinimumSize = new Size(760, 520);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = Ui.Page;
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);

        BuildUi();
        RenderList();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(22),
            BackColor = Ui.Page
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 315));
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(root);

        var left = new RoundPanel
        {
            Dock = DockStyle.Fill,
            Radius = 18,
            Padding = new Padding(16),
            StartColor = Color.FromArgb(22, 28, 38),
            EndColor = Color.FromArgb(13, 18, 27),
            Glow = false
        };
        root.Controls.Add(left, 0, 0);

        var leftGrid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 3,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        leftGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        leftGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        leftGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 96));
        left.Controls.Add(leftGrid);

        leftGrid.Controls.Add(new Label
        {
            Text = "Streaming-Anbieter",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
            BackColor = Color.Transparent
        }, 0, 0);

        providerList.Dock = DockStyle.Fill;
        providerList.BackColor = Color.FromArgb(14, 19, 28);
        providerList.ForeColor = Color.White;
        providerList.BorderStyle = BorderStyle.None;
        providerList.Font = new Font("Segoe UI", 11, FontStyle.Bold);
        providerList.SelectedIndexChanged += (_, _) => LoadSelected();
        leftGrid.Controls.Add(providerList, 0, 1);

        var order = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 2,
            BackColor = Color.Transparent
        };
        order.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        order.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        order.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        order.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        leftGrid.Controls.Add(order, 0, 2);

        var up = SettingsButton("Hoch");
        up.Click += (_, _) => MoveSelected(-1);
        order.Controls.Add(up, 0, 0);

        var down = SettingsButton("Runter");
        down.Click += (_, _) => MoveSelected(1);
        order.Controls.Add(down, 1, 0);

        var delete = SettingsButton("Loeschen");
        delete.NormalColor = Color.FromArgb(104, 24, 34);
        delete.HoverColor = Color.FromArgb(132, 32, 45);
        delete.Click += (_, _) => DeleteSelected();
        order.Controls.Add(delete, 0, 1);

        var clear = SettingsButton("Neu");
        clear.Click += (_, _) => ClearFields();
        order.Controls.Add(clear, 1, 1);

        var form = new RoundPanel
        {
            Dock = DockStyle.Fill,
            Radius = 18,
            Margin = new Padding(18, 0, 0, 0),
            Padding = new Padding(22),
            StartColor = Color.FromArgb(18, 24, 34),
            EndColor = Color.FromArgb(10, 14, 21),
            Glow = false
        };
        root.Controls.Add(form, 1, 0);

        var formGrid = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 12,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        form.Controls.Add(formGrid);

        formGrid.Controls.Add(new Label
        {
            Text = "Provider bearbeiten",
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 18, FontStyle.Bold),
            BackColor = Color.Transparent
        }, 0, 0);

        formGrid.Controls.Add(FormLabel("Name"), 0, 1);
        StyleSettingsInput(nameBox, "IMDb");
        formGrid.Controls.Add(nameBox, 0, 2);

        formGrid.Controls.Add(FormLabel("Website / Startseite"), 0, 3);
        StyleSettingsInput(websiteBox, "https://www.imdb.com");
        formGrid.Controls.Add(websiteBox, 0, 4);

        formGrid.Controls.Add(FormLabel("Such-URL optional"), 0, 5);
        StyleSettingsInput(searchTemplateBox, "https://www.imdb.com/find/?q={query}");
        formGrid.Controls.Add(searchTemplateBox, 0, 6);

        formGrid.Controls.Add(FormLabel("Logo optional"), 0, 7);
        StyleSettingsInput(logoBox, "IM");
        formGrid.Controls.Add(logoBox, 0, 8);

        enabledBox.Text = "Aktiv in der Anbieter-Leiste anzeigen";
        enabledBox.Checked = true;
        enabledBox.Dock = DockStyle.Fill;
        enabledBox.ForeColor = Color.White;
        enabledBox.BackColor = Color.Transparent;
        formGrid.Controls.Add(enabledBox, 0, 9);

        formGrid.Controls.Add(new Label
        {
            Text = "Wenn keine Such-URL eingetragen ist, nutzt die App automatisch eine normale site:-Websuche fuer diese Website.",
            Dock = DockStyle.Top,
            Height = 54,
            ForeColor = Ui.Muted,
            Font = new Font("Segoe UI", 9),
            BackColor = Color.Transparent
        }, 0, 10);

        var save = SettingsButton("Speichern");
        save.NormalColor = Ui.Red;
        save.HoverColor = Color.FromArgb(245, 40, 54);
        save.Click += (_, _) => SaveCurrent();
        formGrid.Controls.Add(save, 0, 11);
    }

    private void RenderList()
    {
        providerList.Items.Clear();
        foreach (var provider in providers)
        {
            providerList.Items.Add($"{(provider.IsEnabled ? "●" : "○")} {provider.Name}");
        }

        if (providerList.Items.Count > 0 && providerList.SelectedIndex < 0)
        {
            providerList.SelectedIndex = 0;
        }
    }

    private void LoadSelected()
    {
        if (providerList.SelectedIndex < 0 || providerList.SelectedIndex >= providers.Count)
        {
            return;
        }

        var provider = providers[providerList.SelectedIndex];
        nameBox.Text = provider.Name;
        websiteBox.Text = provider.HomeUrl;
        searchTemplateBox.Text = provider.Template;
        logoBox.Text = provider.Logo;
        enabledBox.Checked = provider.IsEnabled;
    }

    private void SaveCurrent()
    {
        if (!HubForm.TryBuildProvider(nameBox.Text, websiteBox.Text, searchTemplateBox.Text, logoBox.Text, enabledBox.Checked, out var provider, out var error))
        {
            MessageBox.Show(error, "Provider pruefen", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var selected = providerList.SelectedIndex;
        if (selected >= 0 && selected < providers.Count)
        {
            provider.Id = providers[selected].Id;
            providers[selected] = provider;
        }
        else
        {
            providers.Add(provider);
            selected = providers.Count - 1;
        }

        RenderList();
        providerList.SelectedIndex = selected;
        changed = true;
    }

    private void DeleteSelected()
    {
        var selected = providerList.SelectedIndex;
        if (selected < 0 || selected >= providers.Count)
        {
            return;
        }

        providers.RemoveAt(selected);
        RenderList();
        if (providers.Count > 0)
        {
            providerList.SelectedIndex = Math.Min(selected, providers.Count - 1);
        }
        changed = true;
    }

    private void MoveSelected(int direction)
    {
        var selected = providerList.SelectedIndex;
        var target = selected + direction;
        if (selected < 0 || target < 0 || target >= providers.Count)
        {
            return;
        }

        (providers[selected], providers[target]) = (providers[target], providers[selected]);
        RenderList();
        providerList.SelectedIndex = target;
        changed = true;
    }

    private void ClearFields()
    {
        providerList.ClearSelected();
        nameBox.Clear();
        websiteBox.Clear();
        searchTemplateBox.Clear();
        logoBox.Clear();
        enabledBox.Checked = true;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (DialogResult != DialogResult.OK)
        {
            DialogResult = changed ? DialogResult.OK : DialogResult.Cancel;
        }

        base.OnFormClosing(e);
    }

    private static Label FormLabel(string text)
    {
        return new Label
        {
            Text = text,
            Dock = DockStyle.Fill,
            ForeColor = Ui.Muted,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            TextAlign = ContentAlignment.BottomLeft,
            BackColor = Color.Transparent
        };
    }

    private static void StyleSettingsInput(TextBox box, string placeholder)
    {
        box.Dock = DockStyle.Fill;
        box.PlaceholderText = placeholder;
        box.BackColor = Color.FromArgb(13, 18, 27);
        box.ForeColor = Color.White;
        box.BorderStyle = BorderStyle.FixedSingle;
        box.Font = new Font("Segoe UI", 10);
        box.Margin = new Padding(0, 3, 0, 8);
    }

    private static RoundButton SettingsButton(string text)
    {
        return new RoundButton
        {
            Text = text,
            Dock = DockStyle.Fill,
            Radius = 13,
            Margin = new Padding(5),
            NormalColor = Color.FromArgb(35, 44, 58),
            HoverColor = Color.FromArgb(58, 70, 89),
            TextColor = Color.White,
            Font = new Font("Segoe UI", 9, FontStyle.Bold)
        };
    }
}

public sealed class RoundButton : Button
{
    private bool hovered;
    private bool pressed;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int Radius { get; set; } = 14;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color NormalColor { get; set; } = Color.FromArgb(38, 46, 60);

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color HoverColor { get; set; } = Color.FromArgb(56, 68, 86);

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color PressedColor { get; set; } = Color.FromArgb(82, 94, 112);

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color TextColor { get; set; } = Color.White;

    public RoundButton()
    {
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        hovered = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        hovered = false;
        pressed = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs mevent)
    {
        pressed = true;
        Invalidate();
        base.OnMouseDown(mevent);
    }

    protected override void OnMouseUp(MouseEventArgs mevent)
    {
        pressed = false;
        Invalidate();
        base.OnMouseUp(mevent);
    }

    protected override void OnPaint(PaintEventArgs pevent)
    {
        pevent.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Ui.RoundedPath(ClientRectangle, Radius);
        using var brush = new SolidBrush(pressed ? PressedColor : hovered ? HoverColor : NormalColor);
        pevent.Graphics.FillPath(brush, path);

        TextRenderer.DrawText(
            pevent.Graphics,
            Text,
            Font,
            ClientRectangle,
            TextColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    }
}

public sealed class RoundPanel : Panel
{
    private Size originalSize;
    private bool hasOriginalSize;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color StartColor { get; set; } = Color.FromArgb(24, 30, 41);

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Color EndColor { get; set; } = Color.FromArgb(15, 20, 29);

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int Radius { get; set; } = 18;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Glow { get; set; }

    public RoundPanel()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
    }

    public void ScaleTo(float factor)
    {
        if (!hasOriginalSize)
        {
            originalSize = Size;
            hasOriginalSize = true;
        }

        Size = new Size((int)(originalSize.Width * factor), (int)(originalSize.Height * factor));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Width - 1, Height - 1);

        using var path = Ui.RoundedPath(rect, Radius);
        using var shadow = new SolidBrush(Color.FromArgb(70, 0, 0, 0));
        using var shadowPath = Ui.RoundedPath(new Rectangle(4, 5, Math.Max(1, Width - 8), Math.Max(1, Height - 8)), Radius);
        e.Graphics.FillPath(shadow, shadowPath);

        using var brush = new LinearGradientBrush(rect, StartColor, EndColor, 20f);
        e.Graphics.FillPath(brush, path);

        if (Glow)
        {
            using var glow = new SolidBrush(Color.FromArgb(38, 255, 255, 255));
            e.Graphics.FillEllipse(glow, Width - 120, -75, 190, 130);
        }

        base.OnPaint(e);
    }
}

internal static class Ui
{
    public static readonly Color Page = Color.FromArgb(7, 10, 16);
    public static readonly Color Red = Color.FromArgb(229, 9, 20);
    public static readonly Color Muted = Color.FromArgb(166, 176, 191);

    public static GraphicsPath RoundedPath(Rectangle bounds, int radius)
    {
        var diameter = Math.Max(2, radius * 2);
        var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
