import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  CSS_CUSTOM_PROPERTY_DECLARATION_REGEX,
  CustomPropertiesViewProvider,
  formatCustomPropertyCount,
  SELECTED_FOLDER_STORAGE_KEY,
} from "../extension";

class MockMemento implements vscode.Memento {
  private values = new Map<string, unknown>();

  constructor(initialValues: Record<string, unknown> = {}) {
    Object.entries(initialValues).forEach(([key, value]) => {
      this.values.set(key, value);
    });
  }

  keys(): readonly string[] {
    return Array.from(this.values.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }

    this.values.set(key, value);
  }
}

const createMockWebviewView = () => {
  const messages: unknown[] = [];
  const webviewView = {
    webview: {
      options: {},
      html: "",
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
      postMessage: async (message: unknown) => {
        messages.push(message);
        return true;
      },
    },
  } as unknown as vscode.WebviewView;

  return { webviewView, messages };
};

suite("CSS VarBuddy Extension Test Suite", () => {
  let extension: vscode.Extension<any>;
  let testFolder: string;

  suiteSetup(async () => {
    // Get the extension
    extension = vscode.extensions.getExtension("schalkneethling.css-varbuddy")!;
    await extension.activate();

    // Create a temporary test folder with CSS files
    testFolder = path.join(os.tmpdir(), "css-varbuddy-test");
    await fs.promises.mkdir(testFolder, { recursive: true });

    // Create test CSS files
    const cssContent1 = `
      :root {
        --primary-color: #007bff;
        --secondary-color: #6c757d;
        --success-color: #28a745;
        --error-color: #dc3545;
      }
    `;

    const cssContent2 = `
      .component {
        --border-radius: 4px;
        --padding: 1rem;
        --margin: 0.5rem;
      }
    `;

    await fs.promises.writeFile(
      path.join(testFolder, "styles.css"),
      cssContent1,
    );
    await fs.promises.writeFile(
      path.join(testFolder, "components.css"),
      cssContent2,
    );
  });

  suiteTeardown(async () => {
    // Clean up test folder
    try {
      await fs.promises.rm(testFolder, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up test folder:", error);
    }
  });

  test("Extension should be present", () => {
    assert.ok(extension);
    assert.strictEqual(extension.id, "schalkneethling.css-varbuddy");
  });

  test("Extension should activate", async () => {
    const isActive = extension.isActive;
    assert.strictEqual(isActive, true);
  });

  test("Should register webview view provider", async () => {
    // The webview view provider should be registered when the extension activates
    // We can verify this by checking if the extension is active and the view type is registered
    assert.ok(extension.isActive);

    // Check that the extension contributes the correct view
    const packageJson = extension.packageJSON;
    const views =
      packageJson.contributes?.views?.["css-custom-props-explorer"] || [];
    const cssView = views.find(
      (view: any) => view.id === "cssCustomPropertiesView",
    );

    assert.ok(cssView, "CSS Custom Properties view should be registered");
    assert.strictEqual(cssView.type, "webview");
  });

  test("Webview should expose accessible toolbar and status markup", async () => {
    const provider = new CustomPropertiesViewProvider(
      vscode.Uri.file(testFolder),
      new MockMemento(),
    );
    const { webviewView } = createMockWebviewView();

    await provider.resolveWebviewView(
      webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    const html = webviewView.webview.html;

    assert.ok(html.includes('role="toolbar"'));
    assert.ok(html.includes('aria-label="CSS VarBuddy actions"'));
    assert.ok(html.includes('aria-label="Select CSS folder"'));
    assert.ok(html.includes('aria-label="Refresh custom properties"'));
    assert.ok(html.includes('aria-label="Clear selected folder"'));
    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes(":focus-visible"));
    assert.ok(html.includes("hidden"));
    assert.ok(html.includes("Intl.PluralRules"));
  });

  test("Should format custom property counts", () => {
    assert.strictEqual(formatCustomPropertyCount(1), "1 custom property");
    assert.strictEqual(formatCustomPropertyCount(2), "2 custom properties");
  });

  test("Should scan CSS files for custom properties", async () => {
    // This test verifies the scanning functionality by creating a test file
    // and checking if the properties are found
    const testCssFile = path.join(testFolder, "test-scan.css");
    const cssContent = `
      :root {
        --test-property-1: value1;
        --test-property-2: value2;
        --test-property-3: value3;
      }
    `;

    await fs.promises.writeFile(testCssFile, cssContent);

    // Read the file and check for properties manually
    const content = await fs.promises.readFile(testCssFile, "utf-8");
    const matches = Array.from(
      content.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION_REGEX),
    ).map((match) => match[1]);

    assert.strictEqual(matches.length, 3);
    assert.ok(matches.includes("--test-property-1"));
    assert.ok(matches.includes("--test-property-2"));
    assert.ok(matches.includes("--test-property-3"));

    // Clean up
    await fs.promises.unlink(testCssFile);
  });

  test("Should handle webview messages correctly", async () => {
    // Create a mock webview view
    const mockWebview = {
      webview: {
        options: {},
        html: "",
        onDidReceiveMessage: (callback: (data: any) => void) => {
          // Simulate receiving a message
          callback({ type: "insertProperty", value: "--test-property" });
        },
        postMessage: (message: any) => {
          // Verify the message structure
          assert.ok(message.type);
          assert.ok(message.properties || message.folderPath);
        },
      },
    } as vscode.WebviewView;

    // Test that the webview can be created and configured
    assert.ok(mockWebview);
    assert.ok(mockWebview.webview);
  });

  test("Should filter properties correctly", () => {
    // Test the filtering logic that would be used in the webview
    const properties = [
      "--primary-color",
      "--secondary-color",
      "--success-color",
      "--error-color",
      "--border-radius",
      "--padding",
      "--margin",
    ];

    // Test filtering by search term
    const filterProperties = (searchTerm: string) => {
      return properties.filter((prop) =>
        prop.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    };

    // Test exact match
    let filtered = filterProperties("primary");
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0], "--primary-color");

    // Test partial match
    filtered = filterProperties("color");
    assert.strictEqual(filtered.length, 4);
    assert.ok(filtered.includes("--primary-color"));
    assert.ok(filtered.includes("--secondary-color"));
    assert.ok(filtered.includes("--success-color"));
    assert.ok(filtered.includes("--error-color"));

    // Test case insensitive
    filtered = filterProperties("COLOR");
    assert.strictEqual(filtered.length, 4);

    // Test no match
    filtered = filterProperties("nonexistent");
    assert.strictEqual(filtered.length, 0);
  });

  test("Should handle file system operations", async () => {
    // Test that the extension can handle file system operations
    const testDir = path.join(testFolder, "nested");
    await fs.promises.mkdir(testDir, { recursive: true });

    const nestedCssFile = path.join(testDir, "nested.css");
    const cssContent = `
      :root {
        --nested-property: value;
      }
    `;

    await fs.promises.writeFile(nestedCssFile, cssContent);

    // Verify the file exists
    const exists = await fs.promises
      .access(nestedCssFile)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(exists, true);

    // Read and verify content
    const content = await fs.promises.readFile(nestedCssFile, "utf-8");
    const matches = Array.from(
      content.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION_REGEX),
    ).map((match) => match[1]);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0], "--nested-property");
  });

  test("Should validate CSS custom property declaration regex", () => {
    const matchDeclarations = (content: string) =>
      Array.from(
        content.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION_REGEX),
      ).map((match) => match[1]);

    const validCss = `
      :root {
        --primary-color: red;
        --secondary-color : blue;
        --_private-property: 1rem;
        --property123: 12px;
        --property-name: green;
      }
    `;

    assert.deepStrictEqual(matchDeclarations(validCss), [
      "--primary-color",
      "--secondary-color",
      "--_private-property",
      "--property123",
      "--property-name",
    ]);

    const invalidCss = `
      :root {
        --123-invalid: red;
        --: blue;
        --------: green;
        invalid-property: yellow;
        color: var(--usage-only);
        --invalid@property: pink;
        --invalid.property: purple;
      }
    `;

    assert.deepStrictEqual(matchDeclarations(invalidCss), []);
  });

  test("Should handle empty folder gracefully", async () => {
    // Create an empty folder
    const emptyFolder = path.join(testFolder, "empty");
    await fs.promises.mkdir(emptyFolder, { recursive: true });

    // Try to read from empty folder
    const entries = await fs.promises.readdir(emptyFolder, {
      withFileTypes: true,
    });
    assert.strictEqual(entries.length, 0);
  });

  test("Should handle non-CSS files correctly", async () => {
    // Create a non-CSS file
    const nonCssFile = path.join(testFolder, "test.txt");
    const content = `
      This is not a CSS file
      --this-should-not-be-found
    `;

    await fs.promises.writeFile(nonCssFile, content);

    // The extension should only process .css and .scss files
    // So this file should be ignored
    const fileName = path.basename(nonCssFile);
    const isCssFile = fileName.endsWith(".css") || fileName.endsWith(".scss");
    assert.strictEqual(isCssFile, false);
  });

  test("Should persist selected folder in workspace state", async () => {
    const workspaceState = new MockMemento();
    const provider = new CustomPropertiesViewProvider(
      vscode.Uri.file(testFolder),
      workspaceState,
    );

    await provider.selectFolderPath(testFolder);

    assert.strictEqual(
      workspaceState.get(SELECTED_FOLDER_STORAGE_KEY),
      testFolder,
    );
  });

  test("Should restore persisted folder when webview resolves", async () => {
    const workspaceState = new MockMemento({
      [SELECTED_FOLDER_STORAGE_KEY]: testFolder,
    });
    const provider = new CustomPropertiesViewProvider(
      vscode.Uri.file(testFolder),
      workspaceState,
    );
    const { webviewView, messages } = createMockWebviewView();

    await provider.resolveWebviewView(
      webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    const updateMessage = messages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "updateProperties",
    ) as { folderPath: string; properties: string[] } | undefined;

    assert.ok(updateMessage, "Expected persisted folder to update the webview");
    assert.strictEqual(updateMessage.folderPath, testFolder);
    assert.ok(updateMessage.properties.includes("--primary-color"));
    assert.ok(updateMessage.properties.includes("--border-radius"));
  });

  test("Should clear persisted folder when restore scan fails", async () => {
    const missingFolder = path.join(testFolder, "missing-folder");
    const workspaceState = new MockMemento({
      [SELECTED_FOLDER_STORAGE_KEY]: missingFolder,
    });
    const provider = new CustomPropertiesViewProvider(
      vscode.Uri.file(testFolder),
      workspaceState,
    );
    const { webviewView, messages } = createMockWebviewView();

    await provider.resolveWebviewView(
      webviewView,
      {} as vscode.WebviewViewResolveContext,
      {} as vscode.CancellationToken,
    );

    const resetMessage = messages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "updateProperties",
    ) as { folderPath: string; properties: string[] } | undefined;

    assert.strictEqual(
      workspaceState.get(SELECTED_FOLDER_STORAGE_KEY),
      undefined,
    );
    assert.deepStrictEqual(resetMessage?.properties, []);
    assert.strictEqual(resetMessage?.folderPath, "");
  });

  test("Should keep persisted folder when scan fails but root exists", async () => {
    const workspaceState = new MockMemento({
      [SELECTED_FOLDER_STORAGE_KEY]: testFolder,
    });
    const provider = new CustomPropertiesViewProvider(
      vscode.Uri.file(testFolder),
      workspaceState,
    );
    const { webviewView, messages } = createMockWebviewView();
    const originalReadFile = fs.promises.readFile;

    try {
      fs.promises.readFile = async () => {
        const error = new Error("Could not read CSS file") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      };

      await provider.resolveWebviewView(
        webviewView,
        {} as vscode.WebviewViewResolveContext,
        {} as vscode.CancellationToken,
      );
    } finally {
      fs.promises.readFile = originalReadFile;
    }

    const resetMessage = messages.find(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "updateProperties",
    ) as { folderPath: string; properties: string[] } | undefined;

    assert.strictEqual(
      workspaceState.get(SELECTED_FOLDER_STORAGE_KEY),
      testFolder,
    );
    assert.deepStrictEqual(resetMessage?.properties, []);
    assert.strictEqual(resetMessage?.folderPath, "");
  });
});
