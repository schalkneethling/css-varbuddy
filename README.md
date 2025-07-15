# CSS VarBuddy

Index, find, and use your CSS custom properties in a snap.

## Features

CSS VarBuddy provides a dedicated sidebar in VS Code that allows you to:

- **🔍 Auto-scan** your workspace for CSS custom properties
- **📁 Select folders** to scan for CSS and SCSS files
- **🔎 Filter properties** with real-time search
- **⚡ Quick insert** custom properties into your active editor
- **🔄 Refresh** to re-scan for updated properties
- **🎨 Theme adaptive** interface that matches your VS Code theme

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "CSS VarBuddy"
4. Click Install

### From Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch the extension in a new VS Code window

## Usage

1. **Open the sidebar**: Click the CSS Custom Properties icon in the activity bar (left sidebar)
2. **Auto-scan**: The extension automatically scans your current workspace
3. **Select folder**: Click "Select CSS Folder" to choose a specific directory to scan
4. **Search**: Use the search box to filter properties by name
5. **Insert**: Click on any property to insert `var(--property-name)` at your cursor position
6. **Refresh**: Click "Refresh" to re-scan for updated properties

## Supported File Types

- `.css` files
- `.scss` files

## Development

### Prerequisites

- Node.js
- npm
- VS Code

### Setup

```bash
git clone https://github.com/schalkneethling/css-varbuddy.git
cd css-varbuddy
npm install
```

### Scripts

- `npm run compile` - Compile TypeScript
- `npm run watch` - Watch for changes and recompile
- `npm run lint` - Run ESLint
- `npm run package` - Create VSIX package
- `npm run publish` - Publish to VS Code Marketplace

### Debugging

1. Open the project in VS Code
2. Press F5 to launch the extension in a new window
3. The CSS Custom Properties sidebar will be available in the new window

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Version History

### 0.3.0

- ✨ Added proper VS Code sidebar integration
- 🎨 Improved UI with theme-adaptive design
- 🔄 Added refresh functionality
- 📁 Auto-scan workspace folders
- 🎯 Better TypeScript compilation setup
- 📦 Added publishing scripts
