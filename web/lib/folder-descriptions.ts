/**
 * Real, well-established descriptions for common dotfiles/config
 * directories — added 2026-09-02 after Deepak looked at his own real
 * Home folder and said he had no idea what most of the blocks meant,
 * even though he created every one of them. A raw folder name isn't
 * self-explanatory, even to its own owner — this is the direct fix.
 *
 * Deliberately only covers folders whose purpose is a well-documented,
 * verifiable fact about the tool that owns them (never a guess) — a
 * folder like `.coding-local` or `dev` is Deepak's own naming, not a
 * known convention, so it's intentionally left undescribed here rather
 * than fabricated.
 */
const FOLDER_DESCRIPTIONS: Record<string, string> = {
  ".cache": "General-purpose cache used by many command-line tools — usually safe to clear, regenerates on its own",
  ".npm": "npm's package download cache",
  ".npm-global": "Globally-installed npm command-line tools (packages installed with npm install -g)",
  ".vscode": "VS Code's installed extensions and local data",
  ".vscode-shared": "Shared VS Code data across profiles",
  ".vscode-react-native": "VS Code's React Native tooling data",
  ".cursor": "Cursor editor's installed extensions and local data",
  ".claude": "Claude Code's local data — sessions, settings, cached skills",
  ".claude-code-router": "Claude Code Router's local data",
  ".kiro": "Kiro editor's local data",
  ".codex": "OpenAI Codex CLI's local data and session history",
  ".codex-a": "A separate OpenAI Codex CLI profile/session data",
  ".codex-b": "A separate OpenAI Codex CLI profile/session data",
  ".codex-c": "A separate OpenAI Codex CLI profile/session data",
  ".opencode": "OpenCode CLI's local data",
  ".pi": "Pi coding agent's local data",
  ".factory": "Factory CLI's local data",
  ".continue": "Continue (AI coding assistant)'s local data",
  ".cline": "Cline (AI coding assistant)'s local data",
  ".copilot": "GitHub Copilot's local data",
  ".quokka": "Quokka.js's local data",
  ".wallaby": "Wallaby.js's local data",
  ".hyperframes": "HyperFrames' local data",
  ".rustup": "Rust's toolchain manager — installed Rust compiler versions",
  ".pyenv": "pyenv's installed Python versions",
  ".docker": "Docker Desktop's local data (images, volumes, the Linux VM disk)",
  ".config": "App configuration files — used by many command-line tools (the XDG convention)",
  ".local": "User-local installs and data — used by many tools (pip, pipx, etc.)",
  ".ssh": "SSH keys and connection config",
  ".aws": "AWS CLI credentials and config",
  ".gnupg": "GPG encryption keys",
  ".android": "Android SDK and emulator data",
  ".antigravity": "Antigravity's local data",
  ".gemini": "Gemini CLI's local data",
  ".bun": "Bun's installed runtime and package cache",
  ".pencil": "Pencil's local data",
  ".n8n": "n8n's local workflow data",
  ".dbclient": "A database client's local data",
  ".notebooklm": "NotebookLM-related local data",
  ".happy": "Happy CLI's local data",
  ".agents": "Local agent configuration data",
  ".gem": "Ruby gems installed for your user",
  ".expo": "Expo (React Native tooling)'s local data",
  ".playwright-mcp": "Playwright MCP's local data (browser automation)",
  ".tinybird": "Tinybird CLI's local data",
  ".vibe-ads": "Vibe Ads' local data",
  ".gsutil": "Google Cloud Storage CLI's local data",
  ".mcp-auth": "Saved MCP (Model Context Protocol) authentication tokens",
  ".swiftpm": "Swift Package Manager's local cache",
  ".pyc": "Compiled Python bytecode cache",
  ".idlerc": "Python IDLE's config",
  // Cache CHILDREN — added 2026-09-03. Until now ~/.cache and ~/.npm were
  // each flagged as one undifferentiated blob, so their children never
  // appeared as separate rows and never needed names. Now that each is
  // its own decision, each needs to say what it is: "uv" and "_cacache"
  // are meaningless folder names even to the person whose disk they're on.
  huggingface: "Downloaded machine-learning models (Hugging Face) — re-downloadable, but large and slow to fetch again",
  uv: "uv's Python package cache — re-downloads on demand, clear with `uv cache clean`",
  whisper: "Downloaded Whisper speech-to-text models — re-downloadable",
  puppeteer: "A headless Chromium browser downloaded by Puppeteer",
  _cacache: "npm's package download cache — npm re-downloads what it needs, clear with `npm cache clean --force`",
  _npx: "Packages cached from one-off `npx` runs — re-fetched when you next run one",
  _prebuilds: "Prebuilt native binaries downloaded by npm packages",
  _logs: "npm's debug logs from failed installs",
  "ms-playwright": "Browsers downloaded by Playwright for automated testing",
  "ms-playwright-mcp": "A second copy of Playwright's browsers, downloaded by the Playwright MCP server",
  pip: "pip's Python package cache — clear with `pip cache purge`",
  Homebrew: "Homebrew's downloaded package archives — clear with `brew cleanup`",
  pnpm: "pnpm's shared package store — prune with `pnpm store prune`",
  "node-gyp": "Node.js headers downloaded for compiling native modules",
  "next-swc": "Next.js's compiler cache — rebuilt on the next build",
  hyperframes: "HyperFrames' cache — downloaded assets and render artifacts",
  chroma: "Chroma's downloaded model files (vector database)",
  n8n: "n8n's cached workflow data",
  kilo: "Kilo's local cache",
  "vscode-ripgrep": "A ripgrep search binary downloaded by VS Code",
  "yt-dlp": "yt-dlp's cache",
  Library: "macOS and app data — mixed real app data and caches, not one single thing",
  ".Trash": "macOS's Trash — items deleted but not yet permanently removed",
  // Common dev-project folders — added 2026-09-02 so a description shows
  // no matter how deep you're browsing, not only at the top level.
  node_modules: "JavaScript/Node dependencies — regenerated automatically by running install again",
  DerivedData: "Xcode's build cache — regenerated automatically on next build",
  __pycache__: "Compiled Python bytecode cache for this folder",
  venv: "A Python virtual environment — regenerated with the same setup command that made it",
  ".venv": "A Python virtual environment — regenerated with the same setup command that made it",
  Pods: "CocoaPods dependencies — regenerated by running pod install again",
  dist: "Build output — regenerated by re-running the build",
  build: "Build output — regenerated by re-running the build",
  target: "Build output (Rust/Java/etc.) — regenerated by re-running the build",
};

/**
 * Looks up a description by real folder/file NAME — safe to call with
 * either a plain basename ("`.npm`", used everywhere in Browse mode) or
 * a full path ("`.../workspaceStorage/.../node_modules`", used by the
 * Clean up tab, which shows full paths as its display name so context
 * isn't lost) — both resolve to the same real basename before lookup, so
 * a description shows up consistently everywhere an entry appears.
 */
export function getFolderDescription(nameOrPath: string): string | null {
  const basename = nameOrPath.split("/").filter(Boolean).pop() ?? nameOrPath;
  return FOLDER_DESCRIPTIONS[basename] ?? null;
}
