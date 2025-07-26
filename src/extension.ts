import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

class CustomPropertiesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _customProperties: string[] = [];
  private _currentFolder?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "insertProperty":
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await editor.edit((editBuilder) => {
              editor.selections.forEach((selection) => {
                editBuilder.insert(selection.active, `var(${data.value})`);
              });
            });
          }
          break;
        case "selectFolder":
          await this.selectFolder();
          break;
        case "refresh":
          if (this._currentFolder) {
            await this.updateProperties(this._currentFolder);
          }
          break;
      }
    });
  }

  public async refresh() {
    if (this._currentFolder) {
      await this.updateProperties(this._currentFolder);
    }
  }

  public async selectFolder() {
    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select CSS Folder",
    });
    if (folder && folder[0]) {
      this._currentFolder = folder[0].fsPath;
      await this.updateProperties(folder[0].fsPath);
    }
  }

  private async updateProperties(folderPath: string) {
    try {
      this._customProperties = await this.scanFolder(folderPath);
      if (this._view) {
        this._view.webview.postMessage({
          type: "updateProperties",
          properties: this._customProperties,
          folderPath: folderPath,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error scanning folder: ${error}`);
    }
  }

  private async scanFolder(folderPath: string): Promise<string[]> {
    const properties: Set<string> = new Set();
    const files = await this.getAllCssFiles(folderPath);

    for (const file of files) {
      const content = await fs.promises.readFile(file, "utf-8");
      // Match CSS custom properties according to spec: --[a-zA-Z_][a-zA-Z0-9_-]*
      const matches = content.match(/--[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
      matches.forEach((match: string) => properties.add(match));
    }

    return Array.from(properties).sort();
  }

  private async getAllCssFiles(folderPath: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.getAllCssFiles(fullPath)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".css") || entry.name.endsWith(".scss"))
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSS VarBuddy</title>
    <style>
        body {
            padding: 10px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .search-container {
            position: sticky;
            top: 0;
            background-color: var(--vscode-editor-background);
            padding: 10px 0;
            z-index: 1;
        }
        #searchInput {
            width: 100%;
            padding: 5px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        #propertyList {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .property-item {
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
        }
        .property-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .select-folder {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px;
            cursor: pointer;
            border-radius: 2px;
        }
        .select-folder:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .no-properties {
            color: var(--vscode-descriptionForeground);
            text-align: center;
            padding: 20px;
        }
        .folder-info {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            padding: 5px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="folderInfo" class="folder-info" style="display: none;"></div>
        <div style="display: flex; gap: 8px;">
            <button class="select-folder" onclick="selectFolder()">Select CSS Folder</button>
            <button class="select-folder" onclick="refresh()">Refresh</button>
        </div>
        <div class="search-container">
            <input type="text" id="searchInput" placeholder="Filter properties..." />
        </div>
        <ul id="propertyList"></ul>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let properties = [];
        let currentFolder = '';

        function selectFolder() {
            vscode.postMessage({ type: 'selectFolder' });
        }

        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }

        function insertProperty(property) {
            vscode.postMessage({ 
                type: 'insertProperty',
                value: property
            });
        }

        function filterProperties(searchTerm) {
            const filtered = properties.filter(prop => 
                prop.toLowerCase().includes(searchTerm.toLowerCase())
            );
            renderProperties(filtered);
        }

        function renderProperties(props) {
            const list = document.getElementById('propertyList');
            const folderInfo = document.getElementById('folderInfo');
            list.innerHTML = '';
            
            if (currentFolder) {
                const folderName = currentFolder.split('/').pop() || currentFolder.split('\\\\').pop() || 'Unknown';
                folderInfo.textContent = 'Folder: ' + folderName;
                folderInfo.style.display = 'block';
            } else {
                folderInfo.style.display = 'none';
            }
            
            if (props.length === 0 && properties.length > 0) {
                list.innerHTML = '<li class="no-properties">No matching properties found</li>';
                return;
            }
            
            if (properties.length === 0) {
                list.innerHTML = '<li class="no-properties">Select a folder to scan for CSS custom properties</li>';
                return;
            }

            props.forEach(prop => {
                const li = document.createElement('li');
                li.className = 'property-item';
                li.textContent = prop;
                li.onclick = () => insertProperty(prop);
                list.appendChild(li);
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateProperties':
                    properties = message.properties;
                    currentFolder = message.folderPath || '';
                    renderProperties(properties);
                    break;
            }
        });

        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            filterProperties(e.target.value);
        });

        renderProperties(properties);
    </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new CustomPropertiesViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "cssCustomPropertiesView",
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );
}

export function deactivate() {}
