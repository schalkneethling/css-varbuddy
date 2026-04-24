import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export const SELECTED_FOLDER_STORAGE_KEY = "cssVarBuddy.selectedFolder";
export const CSS_CUSTOM_PROPERTY_DECLARATION_REGEX =
  /(?:^|[^A-Za-z0-9_-])(--[A-Za-z_][A-Za-z0-9_-]*)\s*:/gm;

export class CustomPropertiesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _customProperties: string[] = [];
  private _currentFolder?: string;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceState: vscode.Memento,
  ) {}

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

    await this.restoreSelectedFolder();
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
      await this.selectFolderPath(folder[0].fsPath);
    }
  }

  public async selectFolderPath(folderPath: string) {
    this._currentFolder = folderPath;
    await this._workspaceState.update(SELECTED_FOLDER_STORAGE_KEY, folderPath);
    await this.updateProperties(folderPath);
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
      if (await this.isMissingRootFolder(folderPath, error)) {
        await this.clearSelectedFolder();
      } else {
        console.warn(
          `Skipping persisted folder clear because the selected root folder still exists: ${folderPath}`,
        );
      }
      this.postEmptyProperties();
    }
  }

  private async isMissingRootFolder(folderPath: string, error: unknown) {
    if (this.isMissingPathError(error)) {
      try {
        await fs.promises.stat(folderPath);
      } catch (statError) {
        return this.isMissingPathError(statError);
      }
    }

    return false;
  }

  private isMissingPathError(error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
  }

  private async restoreSelectedFolder() {
    const selectedFolder = this._workspaceState.get<string>(
      SELECTED_FOLDER_STORAGE_KEY,
    );

    if (selectedFolder) {
      this._currentFolder = selectedFolder;
      await this.updateProperties(selectedFolder);
    }
  }

  private async clearSelectedFolder() {
    this._currentFolder = undefined;
    this._customProperties = [];
    await this._workspaceState.update(SELECTED_FOLDER_STORAGE_KEY, undefined);
  }

  private postEmptyProperties() {
    if (this._view) {
      this._view.webview.postMessage({
        type: "updateProperties",
        properties: [],
        folderPath: "",
      });
    }
  }

  private async scanFolder(folderPath: string): Promise<string[]> {
    const properties: Set<string> = new Set();
    const files = await this.getAllCssFiles(folderPath);

    for (const file of files) {
      const content = await fs.promises.readFile(file, "utf-8");
      const matches = content.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION_REGEX);
      Array.from(matches).forEach((match) => properties.add(match[1]));
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
  const provider = new CustomPropertiesViewProvider(
    context.extensionUri,
    context.workspaceState,
  );

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
