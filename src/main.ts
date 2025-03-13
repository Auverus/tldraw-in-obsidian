import {
	MarkdownView,
	Plugin,
	TFile,
	ViewState,
	WorkspaceLeaf,
	addIcon,
	normalizePath,
	moment,
	Notice,
	getIcon,
} from "obsidian";
import { TldrawFileView, TldrawView } from "./obsidian/TldrawView";
import {
	DEFAULT_SETTINGS,
	TldrawPluginSettings,
	TldrawSettingsTab,
} from "./obsidian/TldrawSettingsTab";
import {
	checkAndCreateFolder,
	getNewUniqueFilepath,
	isValidViewType,
} from "./utils/utils";
import {
	FILE_EXTENSION,
	FRONTMATTER_KEY,
	MARKDOWN_ICON,
	MARKDOWN_ICON_NAME,
	PaneTarget,
	RIBBON_NEW_FILE,
	TLDRAW_ICON,
	TLDRAW_ICON_NAME,
	VIEW_TYPE_MARKDOWN,
	VIEW_TYPE_TLDRAW,
	VIEW_TYPE_TLDRAW_FILE,
	VIEW_TYPE_TLDRAW_READ_ONLY,
	ViewType,
} from "./utils/constants";
import { createReactStatusBarViewMode } from "./components/StatusBarViewMode";
import { useStatusBarState } from "./utils/stores";
import { Root } from "react-dom/client";
import {
	frontmatterTemplate,
	getTLDataTemplate,
	codeBlockTemplate,
	tlFileTemplate,
} from "./utils/document";
import { around } from "monkey-around";
import { TldrawReadonly } from "./obsidian/TldrawReadonly";
import { pluginBuild } from "./utils/decorators/plugin";
import { markdownPostProcessor } from "./obsidian/plugin/markdown-post-processor";
import { processFontOverrides, processIconOverrides } from "./obsidian/plugin/settings";
import { createRawTldrawFile } from "./utils/tldraw-file";
import { Editor, TLDRAW_FILE_EXTENSION, TLStore, TLAssetId, TLShapeId, Box, createShapeId, sortByIndex, getIndicesBetween} from "tldraw";
import { registerCommands } from "./obsidian/plugin/commands";
import { migrateTldrawFileDataIfNecessary } from "./utils/migrate/tl-data-to-tlstore";
import { pluginMenuLabel } from "./obsidian/menu";
import { TldrawFileListenerMap } from "./obsidian/plugin/TldrawFileListenerMap";
import TLDataDocumentStoreManager from "./obsidian/plugin/TLDataDocumentStoreManager";
import { getTldrawFileDestination } from "./obsidian/plugin/file-destination";
import { tldrawFileToJson } from "./utils/tldraw-file/tldraw-file-to-json";
import UserSettingsManager from "./obsidian/settings/UserSettingsManager";
import * as pdfjs from 'pdfjs-dist';
import { Pdf, PdfPage, loadPdf} from "./utils/file"; // Add this import
import { ResolutionSelectionModal } from "./obsidian/modal/ResolutionSelectionModal";
@pluginBuild
export default class TldrawPlugin extends Plugin {
	// status bar stuff:
	statusBarRoot: HTMLElement;
	statusBarViewModeReactRoot: Root;
	unsubscribeToViewModeState: () => void;
	transientUpdate: boolean = false;

	// keeps track of what view mode each tab-file combo should be in:
	leafFileViewModes: { [leafFileId: string]: ViewType } = {};
	readonly settingsManager = new UserSettingsManager(this);
	readonly tldrawFileListeners = new TldrawFileListenerMap(this);
	readonly tldrawFileMetadataListeners = new TldrawFileListenerMap(this);
	readonly tlDataDocumentStoreManager = new TLDataDocumentStoreManager(this);
	currTldrawEditor?: Editor;

	// misc:
	embedBoundsSelectorIcon: string;
	settings: TldrawPluginSettings;

	async onload() {
		this.registerView(
			VIEW_TYPE_TLDRAW,
			(leaf) => new TldrawView(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_TLDRAW_READ_ONLY,
			(leaf) => new TldrawReadonly(leaf, this)
		);

		this.registerView(
			VIEW_TYPE_TLDRAW_FILE,
			(leaf) => new TldrawFileView(leaf, this)
		)

		// settings:
		await this.settingsManager.loadSettings();
		this.addSettingTab(new TldrawSettingsTab(this.app, this));

		// icons:
		addIcon(TLDRAW_ICON_NAME, TLDRAW_ICON);
		addIcon(MARKDOWN_ICON_NAME, MARKDOWN_ICON);
		this.embedBoundsSelectorIcon = URL.createObjectURL(new Blob([getIcon('frame')?.outerHTML ?? ''], {
			type: 'image/svg+xml'
		}));

		// this creates an icon in the left ribbon:
		this.addRibbonIcon(TLDRAW_ICON_NAME, RIBBON_NEW_FILE, async () => {
			const file = await this.createUntitledTldrFile();
			await this.openTldrFile(file, "current-tab");
		});

		// status bar:
		this.statusBarRoot = this.addStatusBarItem();
		this.statusBarViewModeReactRoot = createReactStatusBarViewMode(
			this.statusBarRoot
		);
		this.setStatusBarViewModeVisibility(false);

		// subscribe to status bar state within react via zustand:
		this.unsubscribeToViewModeState = useStatusBarState.subscribe(
			(state) => state,
			async (state, prevState) => {
				if (
					state.view.mode !== prevState.view.mode &&
					state.view.source === "react"
				)
					await this.updateViewMode(state.view.mode);
			}
		);

		// registers all events needed:
		this.registerEvents();

		// registers all commands:
		this.registerCommands();

		// switches to the tldraw view mode on initial launch
		this.switchToTldrawViewAfterLoad();
		
    // Wait for layout to be ready before adding PDF buttons
    this.app.workspace.onLayoutReady(() => {
        this.addOpenInTldrawButtonToPDFViews();
    });

    // switches to the tldraw view mode on initial launch
    this.switchToTldrawViewAfterLoad();
    
    // Register for layout changes to catch PDF views that appear later
    this.registerEvent(
        this.app.workspace.on("layout-change", () => {
            this.addOpenInTldrawButtonToPDFViews();
        })
    );
		// Change how tldraw files are displayed when reading the document, e.g. when it is embed in another Obsidian document.
		this.registerMarkdownPostProcessor((e, c) => markdownPostProcessor(this, e, c))

		this.registerExtensions(['tldr'], VIEW_TYPE_TLDRAW_FILE)
	}

	onunload() {
		this.tlDataDocumentStoreManager.dispose()
		this.unsubscribeToViewModeState();
		this.statusBarViewModeReactRoot.unmount();
		URL.revokeObjectURL(this.embedBoundsSelectorIcon);
	}

	private registerEvents() {
		const self = this;
		// Monkey patch WorkspaceLeaf to open Tldraw drawings with TldrawView by default
		// inspired from https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/f79181c76a9d6ef9f17ecdfd054aa0e6d7564d1f/src/main.ts#L1649C9-L1649C9
		this.register(
			around(WorkspaceLeaf.prototype, {
				setViewState(next) {
					return function (this: WorkspaceLeaf, state: ViewState, ...rest: any[]) {
						const leaf: WorkspaceLeaf = this;
						const rstate = state.state; // "real" state
						const filePath = rstate?.file as string;
						const viewType = state.type;
						const validViewType = isValidViewType(viewType);

						if (validViewType && filePath) {
							const matr = !!rstate.manuallyTriggered;
							const cache =
								self.app.metadataCache.getCache(filePath);

							if (
								cache?.frontmatter &&
								cache.frontmatter[FRONTMATTER_KEY]
							) {
								const view = matr ? viewType : VIEW_TYPE_TLDRAW;
								const newState = { ...state, type: view };

								const file =
									self.app.vault.getAbstractFileByPath(
										filePath
									);

								if (file instanceof TFile) {
									self.setLeafFileViewMode(view, leaf, file);
									self.updateStatusBarViewMode(view);
								}

								return next.apply(this, [newState, ...rest]);
							}
						}
						return next.apply(this, [state, ...rest]);
					};
				},
			})
		);

		// adds a menu item to the context menu:
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, source) => {
				const file = source.file;
				const leaf = this.app.workspace.getLeaf(false);

				if (!leaf || !(file instanceof TFile)) return;
				if (!this.isTldrawFile(file)) return;

				menu.addItem((item) => {
					item.setIcon(TLDRAW_ICON_NAME)
						.setSection("close")
						.setTitle("View as Tldraw")
						.onClick(async () => {
							await this.updateViewMode(VIEW_TYPE_TLDRAW, leaf);
						});
				});
			})
		);

		// adds a menu item to the file menu (three dots) depending on view mode
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
				if (!(file instanceof TFile)) return;

				if (file.path.endsWith(TLDRAW_FILE_EXTENSION)) {
					menu.addItem((item) => pluginMenuLabel(item
						.setSection('tldraw')
					)).addItem((item) => {
						item.setIcon('edit')
							.setSection('tldraw')
							.setTitle('Edit as new Note')
							.onClick(async () => {
								const newFile = await this.createUntitledTldrFile({
									tlStore: migrateTldrawFileDataIfNecessary(
										await this.app.vault.read(file)
									)
								});
								await this.openTldrFile(newFile, 'new-tab', VIEW_TYPE_TLDRAW_FILE)
								new Notice(`Created a new file for editing "${newFile.path}"`)
							})
					})
					return;
				}

				if (!leaf) return;

				if (!this.isTldrawFile(file)) return;

				const { type } = leaf.getViewState();
				const viewMode = this.getLeafFileViewMode(leaf, file) || type; // current view mode
				const isMDMode = viewMode === VIEW_TYPE_MARKDOWN;

				const view = isMDMode ? VIEW_TYPE_TLDRAW : VIEW_TYPE_MARKDOWN; // opposite view mode
				const icon = isMDMode ? TLDRAW_ICON_NAME : MARKDOWN_ICON_NAME;
				const title = isMDMode ? "View as Tldraw" : "View as Markdown";

				menu.addItem((item) => {
					item.setIcon(icon)
						.setSection("tldraw")
						.setTitle(title)
						.onClick(async () => {
							await this.updateViewMode(view, leaf);
						});
				});
			})
		);

		// handles how this plugin decides what view mode the file should be displayed in
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", async (leaf) => {
				// always set this to false on a leaf change to prevent it from showing on non tldr files
				this.setStatusBarViewModeVisibility(false);

				// guard clause:
				if (!leaf) return;
				const leafViewState = leaf.getViewState();
				const leafViewMode = leafViewState.type;
				const validViewType = isValidViewType(leafViewMode);

				// more guard clause:
				if (!validViewType) return;
				const fileFromState = leafViewState.state.file as string;
				const file = this.app.workspace.getActiveFile();

				// even more guard clauses:
				if (!file || !fileFromState) return;
				if (fileFromState !== file.path || !this.isTldrawFile(file))
					return;

				// update the status bar:
				const viewMode = this.getLeafFileViewMode(leaf, file);
				this.setStatusBarViewModeVisibility(true);
				this.updateStatusBarViewMode(viewMode);
			})
		);

		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (!(file instanceof TFile)) return;

			if (!this.hasTldrawFrontMatterKey(file)) return;

			const listeners = this.tldrawFileListeners.getListeners(file);

			if (listeners === undefined || listeners.length === 0) return;

			listeners.forEach((e) => e.call());
		}))

		this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
			if (!(file instanceof TFile)) return;

			if (!this.hasTldrawFrontMatterKey(file)) return;

			const listeners = this.tldrawFileMetadataListeners.getListeners(file);

			if (listeners === undefined || listeners.length === 0) return;

			listeners.forEach((e) => e.call());
		}))
	}

	private registerCommands = () => registerCommands(this)

	public setStatusBarViewModeVisibility(visible: boolean) {
		if (visible)
			this.statusBarRoot.removeClass("ptl-hide-statusbar-viewmode");
		else this.statusBarRoot.addClass("ptl-hide-statusbar-viewmode");
	}

	public updateStatusBarViewMode(view: ViewType) {
		useStatusBarState.setState({ view: { mode: view, source: "plugin" } });
	}

	public setMarkdownView = async (leaf: WorkspaceLeaf) => {
		await leaf.setViewState({
			type: VIEW_TYPE_MARKDOWN,
			state: { ...leaf.view.getState(), manuallyTriggered: true },
		} as ViewState);
	};

	public setTldrawView = async (leaf: WorkspaceLeaf) => {
		await leaf.setViewState({
			type: VIEW_TYPE_TLDRAW,
			state: { ...leaf.view.getState(), manuallyTriggered: true },
		} as ViewState);
	};

	public setTldrawFileView = async (leaf: WorkspaceLeaf) => {
		await leaf.setViewState({
			type: VIEW_TYPE_TLDRAW_FILE,
			state: { ...leaf.view.getState(), manuallyTriggered: true },
		} as ViewState);
	};

	public setTldrawViewPreview = async (leaf: WorkspaceLeaf) => {
		await leaf.setViewState({
			type: VIEW_TYPE_TLDRAW_READ_ONLY,
			state: { ...leaf.view.getState(), manuallyTriggered: true },
		} as ViewState);
	};

	public async processPdfInEditor(pdf: Pdf): Promise<void> {
		if (!this.currTldrawEditor) {
			throw new Error("Editor not initialized");
		}
		
		// Create assets for PDF pages
		this.currTldrawEditor.createAssets(
			pdf.pages.map((page) => ({
				id: page.assetId as TLAssetId,
				typeName: 'asset',
				type: 'image',
				meta: {},
				props: {
					w: page.bounds.w,
					h: page.bounds.h,
					mimeType: 'image/png',
					src: page.src,
					name: 'page',
					isAnimated: false,
				},
			}))
		);
	
		// Create shapes for PDF pages
		this.currTldrawEditor.createShapes(
			pdf.pages.map((page) => ({
				id: page.shapeId as TLShapeId,
				type: 'image',
				x: page.bounds.x,
				y: page.bounds.y,
				isLocked: true,
				props: {
					assetId: page.assetId as TLAssetId,
					w: page.bounds.w,
					h: page.bounds.h,
				},
			}))
		);
	
		// Apply PDF-specific behavior
		this.applyPdfBehavior(pdf);
	}
	public addOpenInTldrawButtonToPDFViews() {
		// Find all PDF views
		const pdfViews = this.app.workspace.getLeavesOfType("pdf");
		
		for (const leaf of pdfViews) {
		  this.addOpenInTldrawButtonToPDF(leaf);
		}
		
		// Register an event to add the button to new PDF views
		  this.registerEvent(
		  this.app.workspace.on("file-open", (file) => {
			if (file && file.extension === "pdf") {
			  // Get active PDF leaf using app.workspace.activeLeaf
			  const pdfLeaves = this.app.workspace.getLeavesOfType("pdf");
			  const activeLeaf = pdfLeaves.find(leaf => leaf === this.app.workspace.activeLeaf);
			  if (activeLeaf) {
				this.addOpenInTldrawButtonToPDF(activeLeaf);
			  }
			}
		  })
		);
	  }
	  
	  private addOpenInTldrawButtonToPDF(leaf: WorkspaceLeaf) {
		// Get the PDF view
		const view = leaf.view;
		if (!view || !view.containerEl) return;
		
		// Find the toolbar
		const toolbars = view.containerEl.getElementsByClassName("pdf-toolbar");
		if (!toolbars.length) return;
		
		const toolbar = toolbars[0] as HTMLElement;
		
		// Check if button already exists
		const existingButton = toolbar.querySelector('.tldraw-pdf-button');
		if (existingButton) return;
		
		// Create button
		const button = document.createElement('button');
		button.className = 'tldraw-pdf-button pdf-toolbar-button';
		button.setAttribute('aria-label', 'Open in TLDraw');
		button.innerHTML = `<svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
		  <path d="M7.5 0.875C3.83152 0.875 0.875 3.83152 0.875 7.5C0.875 11.1685 3.83152 14.125 7.5 14.125C11.1685 14.125 14.125 11.1685 14.125 7.5C14.125 3.83152 11.1685 0.875 7.5 0.875ZM7.5 1.825C10.6458 1.825 13.175 4.35417 13.175 7.5C13.175 10.6458 10.6458 13.175 7.5 13.175C4.35417 13.175 1.825 10.6458 1.825 7.5C1.825 4.35417 4.35417 1.825 7.5 1.825ZM4.2 9.225L4.90979 8.51521L6.55 10.1554V4.625H7.5V10.1554L9.14021 8.51521L9.85 9.225L7.5 11.575L4.2 9.225Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path>
		</svg>`;
		
		button.addEventListener('click', async () => {
			try {
			  const file = (view as any).file as TFile | null;
			  if (!file) {
				new Notice("Cannot find PDF file");
				return;
			  }
		
			  // 1. Get PDF data
			  const pdfData = await this.app.vault.readBinary(file);
			  
			  // 2. Show resolution dialog and wait for user input
			  const modal = new ResolutionSelectionModal(this.app);
			  const resolution = await modal.openAndGetResolution();
			  
			  if (!resolution) {
				// User cancelled
				return;
			  }
		
			  // 3. Create the tldraw file
			  const pdfFile = await this.createUntitledTldrFile();
			  
			  // 4. Open the file in a new tab
			  const newLeaf = this.app.workspace.getLeaf(true);
			  await newLeaf.openFile(pdfFile);
			  
			  // 5. Set the view mode
			  await this.updateViewMode(VIEW_TYPE_TLDRAW, newLeaf);
			  
			// 6. Wait for editor initialization
			let editorReady = false;
			for (let attempt = 0; attempt < 600; attempt++) {  // 600 attempts * 100ms = 60 seconds (1 minute)
				if (this.currTldrawEditor) {
					editorReady = true;
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}

			if (!editorReady) {
				new Notice("Editor initialization timed out. Please try again.");
				return;
			}
			  // 7. Process the PDF with the selected resolution
			  const loadedPdf = await loadPdf(file.name, pdfData, resolution);
			  await this.processPdfInEditor(loadedPdf);
			  
			  new Notice(`PDF opened at ${resolution}x resolution`);
			  
			  // 8. Schedule Obsidian reload to fix PDF.js environment
			  setTimeout(() => {
				new Notice('Reloading Obsidian to reset PDF environment...');
				setTimeout(() => {
				  (this.app as any).commands.executeCommandById('app:reload');
				}, 1500);
			  }, 1000);
			  
			} catch (error) {
			  console.error("Failed to open PDF in TLDraw:", error);
			  new Notice(`Failed to open PDF in TLDraw: ${error.message}`);
			}
		  });
		  
		  // Add to toolbar
		  toolbar.appendChild(button);
		}
	/**
	 * the leafFileViewMode ID is a combination of the leaf (or tab) id and the file in that tab's path. This is how we can look up what view mode each leaf-file combo has been set.
	 * @param leaf
	 * @param file
	 * @returns
	 */
	public getLeafFileId(leaf?: WorkspaceLeaf, file?: TFile | null) {
		leaf ??= this.app.workspace.getLeaf(false);
		file ??= this.app.workspace.getActiveFile();

		// @ts-ignore: leaf.id exists but the typescript declarations don't say so
		const leafId = leaf.id as string;
		const filePath = file?.path ?? "";

		return `${leafId}-${filePath}`;
	}

	public getLeafFileViewMode(leaf?: WorkspaceLeaf, file?: TFile) {
		const id = this.getLeafFileId(leaf, file);
		const viewMode = this.leafFileViewModes[id];
		return viewMode;
	}

	public setLeafFileViewMode(
		viewMode: ViewType,
		leaf?: WorkspaceLeaf,
		file?: TFile
	) {
		const id = this.getLeafFileId(leaf, file);
		this.leafFileViewModes[id] = viewMode;
	}

	public async updateViewMode(view: ViewType, leaf?: WorkspaceLeaf) {
		view ??= VIEW_TYPE_TLDRAW;
		leaf ??= this.app.workspace.getLeaf(false);

		// guard clause to prevent changing the view if the view is already correct:
		const { type } = leaf?.getViewState();
		if (type === view) return;

		// these functions will actually change the view mode:
		switch (view) {
			case VIEW_TYPE_TLDRAW:
				await this.setTldrawView(leaf)
				break;
			case VIEW_TYPE_TLDRAW_READ_ONLY:
				await this.setTldrawViewPreview(leaf)
				break;
			case VIEW_TYPE_TLDRAW_FILE:
				await this.setTldrawViewPreview(leaf)
				break;
			default:
				console.warn('Uknown tldraw plugin view: ', view)
				await this.setMarkdownView(leaf);
		}
	}

	public async createFile(
		filename: string,
		foldername: string,
		data?: string
	): Promise<TFile> {
		const folderpath = normalizePath(foldername);
		await checkAndCreateFolder(folderpath, this.app.vault); //create folder if it does not exist
		const fname = getNewUniqueFilepath(
			this.app.vault,
			filename,
			folderpath
		);

		return await this.app.vault.create(fname, data ?? "");
	}

	public createTldrFile = async (filename: string, {
		foldername, inMarkdown, tlStore
	}: { foldername: string, inMarkdown: boolean, tlStore?: TLStore }) => {
		const extension = inMarkdown ? FILE_EXTENSION : TLDRAW_FILE_EXTENSION;
		// adds the extension if the filename does not already include it:
		filename = filename.endsWith(extension)
			? filename
			: filename + extension;

		const tldrawFile = createRawTldrawFile(tlStore);
		const fileData = !inMarkdown ? JSON.stringify(tldrawFileToJson(tldrawFile)) : (
			() => {
				// constructs the markdown content thats a template:
				const tlData = getTLDataTemplate(this.manifest.version, tldrawFile, window.crypto.randomUUID());
				const frontmatter = frontmatterTemplate(`${FRONTMATTER_KEY}: true`);
				const codeblock = codeBlockTemplate(tlData);
				return tlFileTemplate(frontmatter, codeblock);
			}
		)();

		return await this.createFile(filename, foldername, fileData);
	};

	public createDefaultFilename() {
		const { newFilePrefix, newFileTimeFormat } = this.settings;

		const date =
			newFileTimeFormat.trim() !== ""
				? moment().format(newFileTimeFormat)
				: "";

		// if both the prefix and the date is empty as contentation
		// then we have to use the defaults to name the file
		let filename = newFilePrefix + date;
		if (filename.trim() === "")
			filename =
				DEFAULT_SETTINGS.newFilePrefix +
				moment().format(DEFAULT_SETTINGS.newFileTimeFormat);

		return filename;
	}

	/**
	 * 
	 * @param attachTo The file that is considered as the "parent" of this new file. If this is not undefined then the new untitled tldr file will be considered as an attachment.
	 * @returns 
	 */
	public createUntitledTldrFile = async ({
		attachTo, tlStore, inMarkdown = true,
	}: {
		attachTo?: TFile, tlStore?: TLStore,
		/**
		 * @default true
		 */
		inMarkdown?: boolean
	} = {}) => {
		const filename = this.createDefaultFilename();
		const res = await getTldrawFileDestination(this, filename, attachTo);
		return this.createTldrFile(res.filename, {
			tlStore,
			inMarkdown,
			foldername: res.folder,
		});
	};

	public openTldrFile = async (file: TFile, location: PaneTarget, viewType: ViewType = VIEW_TYPE_TLDRAW) => {
		let leaf: WorkspaceLeaf;

		if (location === "current-tab")
			leaf = this.app.workspace.getLeaf(false);
		else if (location === "new-tab")
			leaf = this.app.workspace.getLeaf(true);
		else if (location === "new-window")
			leaf = this.app.workspace.getLeaf("window");
		else if (location === "split-tab")
			leaf = this.app.workspace.getLeaf("split");
		else leaf = this.app.workspace.getLeaf(false);

		await leaf.openFile(file);
		await this.updateViewMode(viewType, leaf);
	};
	// public openPDF = async (pdf: ArrayBuffer | string, location: PaneTarget, viewType: ViewType = VIEW_TYPE_TLDRAW) => {
	// 	let leaf: WorkspaceLeaf;

	// 	if (location === "current-tab")
	// 		leaf = this.app.workspace.getLeaf(false);
	// 	else if (location === "new-tab")
	// 		leaf = this.app.workspace.getLeaf(true);
	// 	else if (location === "new-window")
	// 		leaf = this.app.workspace.getLeaf("window");
	// 	else if (location === "split-tab")
	// 		leaf = this.app.workspace.getLeaf("split");
	// 	else leaf = this.app.workspace.getLeaf(false);

	// 	// Create a new tldraw file to display the PDF
	// 	const pdfFile = await this.createUntitledTldrFile();
	// 	await leaf.openFile(pdfFile);
	// 	await this.updateViewMode(viewType, leaf);

	// 	try {
	// 		// Handle different input types for pdf parameter
	// 		let pdfData: ArrayBuffer;
	// 		let fileName: string;
			
	// 		if (typeof pdf === 'string') {
	// 			// If pdf is a URL or file path, fetch it
	// 			fileName = pdf.split('/').pop() || 'document.pdf';
	// 			const response = await fetch(pdf);
	// 			if (!response.ok) {
	// 				throw new Error(`Failed to load PDF: ${response.statusText}`);
	// 			}
	// 			pdfData = await response.arrayBuffer();
	// 		} else {
	// 			// If pdf is already an ArrayBuffer
	// 			fileName = 'document.pdf';
	// 			pdfData = pdf;
	// 		}
			
	// 		// Use the provided loadPdf function
	// 		const pdfResult = await loadPdf(fileName, pdfData);

	// 		if (this.currTldrawEditor) {
	// 			// Create assets for PDF pages
	// 			this.currTldrawEditor.createAssets(
	// 				pdfResult.pages.map((page) => ({
	// 					id: page.assetId as TLAssetId,
	// 					typeName: 'asset',
	// 					type: 'image',
	// 					meta: {},
	// 					props: {
	// 						w: page.bounds.w,
	// 						h: page.bounds.h,
	// 						mimeType: 'image/png',
	// 						src: page.src,
	// 						name: 'page',
	// 						isAnimated: false,
	// 					},
	// 				}))
	// 			);

	// 			// Create shapes for PDF pages
	// 			this.currTldrawEditor.createShapes(
	// 				pdfResult.pages.map((page) => ({
	// 					id: page.shapeId as TLShapeId,
	// 					type: 'image',
	// 					x: page.bounds.x,
	// 					y: page.bounds.y,
	// 					isLocked: true,
	// 					props: {
	// 						assetId: page.assetId as TLAssetId,
	// 						w: page.bounds.w,
	// 						h: page.bounds.h,
	// 					},
	// 				}))
	// 			);

	// 			// Set up camera to frame the PDF
	// 			const firstPage = pdfResult.pages[0];
	// 			if (firstPage) {
	// 				// Assuming Box has appropriate camera-framing methods
	// 				this.currTldrawEditor.setCameraOptions({
	// 					constraints: {
	// 						bounds: firstPage.bounds,
	// 						padding: { x: 164, y: 64 },
	// 						origin: { x: 0.5, y: 0 },
	// 						initialZoom: 'fit-x-100',
	// 						baseZoom: 'default',
	// 						behavior: 'contain',
	// 					},
	// 				});
	// 				this.currTldrawEditor.setCamera(this.currTldrawEditor.getCamera(), { reset: true });
	// 			}
	// 		}
	// 	} catch (error) {
	// 		console.error("Error processing PDF:", error);
	// 		new Notice(`Failed to load PDF: ${error.message}`);
	// 	}
	// }

	// public openPDF = async (pdf: Pdf | ArrayBuffer | string, location: PaneTarget, viewType: ViewType = VIEW_TYPE_TLDRAW) => {
	// 	let leaf: WorkspaceLeaf;
	
	// 	if (location === "current-tab")
	// 		leaf = this.app.workspace.getLeaf(false);
	// 	else if (location === "new-tab")
	// 		leaf = this.app.workspace.getLeaf(true);
	// 	else if (location === "new-window")
	// 		leaf = this.app.workspace.getLeaf("window");
	// 	else if (location === "split-tab")
	// 		leaf = this.app.workspace.getLeaf("split");
	// 	else leaf = this.app.workspace.getLeaf(false);
	
	// 	// Create a new tldraw file to display the PDF
	// 	const pdfFile = await this.createUntitledTldrFile();
	// 	await leaf.openFile(pdfFile);
	// 	await this.updateViewMode(viewType, leaf);
	
	// 	try {
	// 		// Handle different input types for pdf parameter
	// 		let pdfResult: { pages: { assetId: string; shapeId: string; bounds: any; src: string; }[] };
			
	// 		if (typeof pdf === 'object' && 'pages' in pdf) {
	// 			// If pdf is already a Pdf object from file.ts
	// 			pdfResult = {
	// 				pages: pdf.pages
	// 			};
	// 		} else {
	// 			// Previous logic for handling string or ArrayBuffer
	// 			let pdfData: ArrayBuffer;
	// 			let fileName: string;
				
	// 			if (typeof pdf === 'string') {
	// 				// If pdf is a URL or file path, fetch it
	// 				fileName = pdf.split('/').pop() || 'document.pdf';
	// 				const response = await fetch(pdf);
	// 				if (!response.ok) {
	// 					throw new Error(`Failed to load PDF: ${response.statusText}`);
	// 				}
	// 				pdfData = await response.arrayBuffer();
	// 			} else {
	// 				// If pdf is an ArrayBuffer
	// 				fileName = 'document.pdf';
	// 				pdfData = pdf;
	// 			}
				
	// 			// Use the provided loadPdf function
	// 			pdfResult = await loadPdf(fileName, pdfData);
	// 		}
	
	// 		if (this.currTldrawEditor) {
	// 			// Create assets for PDF pages
	// 			this.currTldrawEditor.createAssets(
	// 				pdfResult.pages.map((page) => ({
	// 					id: page.assetId as TLAssetId,
	// 					typeName: 'asset',
	// 					type: 'image',
	// 					meta: {},
	// 					props: {
	// 						w: page.bounds.w,
	// 						h: page.bounds.h,
	// 						mimeType: 'image/png',
	// 						src: page.src,
	// 						name: 'page',
	// 						isAnimated: false,
	// 					},
	// 				}))
	// 			);
	// 		// Create shapes for PDF pages
	// 			this.currTldrawEditor.createShapes(
	// 				pdfResult.pages.map((page) => ({
	// 					id: page.shapeId as TLShapeId,
	// 					type: 'image',
	// 					x: page.bounds.x,
	// 					y: page.bounds.y,
	// 					isLocked: true,
	// 					props: {
	// 						assetId: page.assetId as TLAssetId,
	// 						w: page.bounds.w,
	// 						h: page.bounds.h,
	// 					},
	// 				}))
	// 			);

	// 			// Set up camera to frame the PDF
	// 			const firstPage = pdfResult.pages[0];
	// 			if (firstPage) {
	// 				// Assuming Box has appropriate camera-framing methods
	// 				this.currTldrawEditor.setCameraOptions({
	// 					constraints: {
	// 						bounds: firstPage.bounds,
	// 						padding: { x: 164, y: 64 },
	// 						origin: { x: 0.5, y: 0 },
	// 						initialZoom: 'fit-x-100',
	// 						baseZoom: 'default',
	// 						behavior: 'contain',
	// 					},
	// 				});
	// 				this.currTldrawEditor.setCamera(this.currTldrawEditor.getCamera(), { reset: true });
	// 			}
	// 		}
	// 	} catch (error) {
	// 		console.error("Error processing PDF:", error);
	// 		new Notice(`Failed to load PDF: ${error.message}`);
	// 	}
	// }	
	// 			// Rest of the code remains the same...
	public openPDF = async (pdfInput: Pdf | ArrayBuffer | string, location: PaneTarget, viewType: ViewType = VIEW_TYPE_TLDRAW) => {
		let leaf: WorkspaceLeaf;
	
		if (location === "current-tab")
			leaf = this.app.workspace.getLeaf(false);
		else if (location === "new-tab")
			leaf = this.app.workspace.getLeaf(true);
		else if (location === "new-window")
			leaf = this.app.workspace.getLeaf("window");
		else if (location === "split-tab")
			leaf = this.app.workspace.getLeaf("split");
		else leaf = this.app.workspace.getLeaf(false);
	
		// Create a new tldraw file to display the PDF
		const pdfFile = await this.createUntitledTldrFile();
		await leaf.openFile(pdfFile);
		
		// Prepare the PDF data before waiting for the editor
		let pdfResult: Pdf;
		try {
			if (typeof pdfInput === 'object' && 'pages' in pdfInput) {
				pdfResult = pdfInput;
			} else {
				let pdfData: ArrayBuffer;
				let fileName: string;
				
				if (typeof pdfInput === 'string') {
					fileName = pdfInput.split('/').pop() || 'document.pdf';
					const response = await fetch(pdfInput);
					if (!response.ok) {
						throw new Error(`Failed to load PDF: ${response.statusText}`);
					}
					pdfData = await response.arrayBuffer();
				} else {
					fileName = 'document.pdf';
					pdfData = pdfInput;
				}
				
				pdfResult = await loadPdf(fileName, pdfData);
			}
		} catch (error) {
			console.error("Error processing PDF:", error);
			new Notice(`Failed to load PDF: ${error.message}`);
			return;
		}
		
		// Wait for the view to be ready
		await this.updateViewMode(viewType, leaf);
		
		// Now ensure the editor is ready before continuing
		await this.waitForEditor(10, 100); // Try for up to 1 second (10 attempts * 100ms)
		
		if (!this.currTldrawEditor) {
			new Notice("Failed to initialize the editor. Please try again.");
			return;
		}
		
		try {
			// Create assets for PDF pages
			this.currTldrawEditor.createAssets(
				pdfResult.pages.map((page) => ({
					id: page.assetId as TLAssetId,
					typeName: 'asset',
					type: 'image',
					meta: {},
					props: {
						w: page.bounds.w,
						h: page.bounds.h,
						mimeType: 'image/png',
						src: page.src,
						name: 'page',
						isAnimated: false,
					},
				}))
			);
	
			// Create shapes for PDF pages
			this.currTldrawEditor.createShapes(
				pdfResult.pages.map((page) => ({
					id: page.shapeId as TLShapeId,
					type: 'image',
					x: page.bounds.x,
					y: page.bounds.y,
					isLocked: true,
					props: {
						assetId: page.assetId as TLAssetId,
						w: page.bounds.w,
						h: page.bounds.h,
					},
				}))
			);
	
			// Apply PDF-specific behavior
			this.applyPdfBehavior(pdfResult);

		} catch (error) {
			console.error("Error rendering PDF:", error);
			new Notice(`Failed to render PDF: ${error.message}`);
		}
	}
	
	// Add this helper method to wait for the editor to be initialize

// Add this helper method to wait for the editor to be initialized
private async waitForEditor(attempts: number, delay: number): Promise<void> {
    for (let i = 0; i < attempts; i++) {
        if (this.currTldrawEditor) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}
	
	// Add a new method to handle PDF-specific behavior
	private applyPdfBehavior(pdf: Pdf) {
		if (!this.currTldrawEditor) return;
		
		const editor = this.currTldrawEditor;
		const shapeIds = pdf.pages.map((page) => page.shapeId);
		const shapeIdSet = new Set(shapeIds);
	
		// Don't let the user unlock the pages
		editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next) => {
			if (!shapeIdSet.has(next.id)) return next;
			if (next.isLocked) return next;
			return { ...prev, isLocked: true };
		});
	
		// Make sure the shapes are below any of the other shapes
		const makeSureShapesAreAtBottom = () => {
			const shapes = shapeIds.map((id) => editor.getShape(id)!).sort(sortByIndex);
			const pageId = editor.getCurrentPageId();
	
			const siblings = editor.getSortedChildIdsForParent(pageId);
			const currentBottomShapes = siblings
				.slice(0, shapes.length)
				.map((id) => editor.getShape(id)!);
	
			if (currentBottomShapes.every((shape, i) => shape.id === shapes[i].id)) return;
	
			const otherSiblings = siblings.filter((id) => !shapeIdSet.has(id));
			if (otherSiblings.length === 0) return;
			
			const bottomSibling = otherSiblings[0];
			const lowestIndex = editor.getShape(bottomSibling)!.index;
	
			const indexes = getIndicesBetween(undefined, lowestIndex, shapes.length);
			editor.updateShapes(
				shapes.map((shape, i) => ({
					id: shape.id,
					type: shape.type,
					isLocked: shape.isLocked,
					index: indexes[i],
				}))
			);
		};
	
		makeSureShapesAreAtBottom();
		editor.sideEffects.registerAfterCreateHandler('shape', makeSureShapesAreAtBottom);
		editor.sideEffects.registerAfterChangeHandler('shape', makeSureShapesAreAtBottom);
	
		// Constrain the camera to the bounds of the pages
		const targetBounds = pdf.pages.reduce(
			(acc, page) => acc.union(page.bounds),
			pdf.pages[0].bounds.clone()
		);
	
		const updateCameraBounds = (isMobile: boolean) => {
			editor.setCameraOptions({
				constraints: {
					bounds: targetBounds,
					padding: { x: isMobile ? 16 : 164, y: 64 },
					origin: { x: 0.5, y: 0 },
					initialZoom: 'fit-x-100',
					baseZoom: 'default',
					behavior: 'contain',
				},
			});
			editor.setCamera(editor.getCamera(), { reset: true });
		};
	
		const isMobile = editor.getViewportScreenBounds().width < 840;
		updateCameraBounds(isMobile);
	}


	public isTldrawFile(file: TFile) {
		if (!file) return false;
		return this.hasTldrawFrontMatterKey(file);
	}

	private hasTldrawFrontMatterKey(file: TFile) {
		const fcache = file ? this.app.metadataCache.getFileCache(file) : null;
		return !!fcache?.frontmatter && !!fcache.frontmatter[FRONTMATTER_KEY];
	}

	private switchToTldrawViewAfterLoad() {
		this.app.workspace.onLayoutReady(() => {
			for (let leaf of this.app.workspace.getLeavesOfType("markdown")) {
				if (
					leaf.view instanceof MarkdownView &&
					leaf.view.file &&
					this.isTldrawFile(leaf.view.file)
				) {
					this.updateViewMode(VIEW_TYPE_TLDRAW, leaf);
				}
			}
		});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getEmbedBoundsSelectorIcon() {
		return this.embedBoundsSelectorIcon;
	}

	getFontOverrides() {
		return processFontOverrides(this.settings.fonts?.overrides, (font) => {
			return this.app.vault.adapter.getResourcePath(font).split('?')[0]
		});
	}

	getIconOverrides() {
		return processIconOverrides(this.settings.icons?.overrides, (icon) => {
			return this.app.vault.adapter.getResourcePath(icon).split('?')[0]
		});
	}
}
// interface PdfPage {
// 	assetId: string;
// 	shapeId: string;
// 	bounds: {
// 		x: number;
// 		y: number;
// 		w: number;
// 		h: number;
// 		clone(): {
// 			x: number;
// 			y: number;
// 			w: number;
// 			h: number;
// 			union(other: { x: number, y: number, w: number, h: number }): any;
// 		};
// 	};
// 	src: string;
// }

// interface PdfResult {
// 	pages: PdfPage[];
// }

// async function loadPdf(name: string, arrayBuffer: ArrayBuffer): Promise<PdfResult> {
// 	try {
// 		// Static import for pdf.js (make sure you have added this to your dependencies)
		
// 		// Set the worker source if not already set
// 		if (!pdfjs.GlobalWorkerOptions.workerSrc) {
// 			pdfjs.GlobalWorkerOptions.workerSrc = 
// 			'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
// 		}
		
// 		// Load the PDF document
// 		const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
// 		const numPages = pdf.numPages;
// 		const pages: PdfPage[] = [];
		
// 		// Layout pages in a vertical column with some spacing
// 		let yOffset = 0;
// 		const pageSpacing = 20;
		
// 		// Process each page
// 		for (let i = 1; i <= numPages; i++) {
// 			const page = await pdf.getPage(i);
// 			const viewport = page.getViewport({ scale: 1.5 });
			
// 			// Create a canvas to render the page
// 			const canvas = document.createElement('canvas');
// 			canvas.width = viewport.width;
// 			canvas.height = viewport.height;
			
// 			// Render the page to canvas
// 			await page.render({
// 				canvasContext: canvas.getContext('2d')!,
// 				viewport
// 			}).promise;
			
// 			// Convert canvas to data URL
// 			const src = canvas.toDataURL('image/png');
			
// 			// Create page data
// 			const pageData: PdfPage = {
// 				assetId: `pdf-${name}-page-${i}-${Date.now()}`,
// 				shapeId: `pdf-shape-${name}-page-${i}-${Date.now()}`,
// 				bounds: {
// 					x: 0,
// 					y: yOffset,
// 					w: viewport.width,
// 					h: viewport.height,
// 					clone: function() {
// 						return {
// 							x: this.x,
// 							y: this.y,
// 							w: this.w,
// 							h: this.h,
// 							union: function(other: { x: number, y: number, w: number, h: number }) {
// 								const minX = Math.min(this.x, other.x);
// 								const minY = Math.min(this.y, other.y);
// 								const maxX = Math.max(this.x + this.w, other.x + other.w);
// 								const maxY = Math.max(this.y + this.h, other.y + other.h);
// 								return {
// 									x: minX,
// 									y: minY,
// 									w: maxX - minX,
// 									h: maxY - minY,
// 									clone: function() {
// 										return {
// 											x: this.x,
// 											y: this.y,
// 											w: this.w,
// 											h: this.h,
// 											union: this.union,
// 											clone: this.clone
// 										};
// 									},
// 									union: this.union
// 								};
// 							}
// 						};
// 					}
// 				},
// 				src
// 			};
			
// 			pages.push(pageData);
// 			yOffset += viewport.height + pageSpacing;
// 		}
		
// 		return { pages };
// 	} catch (error) {
// 		console.error("Error loading PDF:", error);
// 		throw new Error(`Failed to load PDF: ${error.message}`);
// 	}
// }

async function loadPdftot(name: string, arrayBuffer: ArrayBuffer): Promise<Pdf> {
    try {
        // Set the worker source if not already set
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = 
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js';
        }
        
        // Load the PDF document
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;
        const pages: PdfPage[] = [];
        
        // Layout pages in a vertical column with some spacing
        let yOffset = 0;
        const pageSpacing = 20;
        
        // Process each page
        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            
            // Create a canvas to render the page
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            // Render the page to canvas
            await page.render({
                canvasContext: canvas.getContext('2d')!,
                viewport
            }).promise;
            
            // Convert canvas to data URL
            const src = canvas.toDataURL('image/png');
            
            // Create page data with the proper asset ID format
            const pageData: PdfPage = {
                src,
                bounds: new Box(0, yOffset, viewport.width, viewport.height),
                assetId: `asset:pdf-${name}-page-${i}-${Date.now()}` as `asset:${string}`,
                shapeId: createShapeId()
            };
            
            pages.push(pageData);
            yOffset += viewport.height + pageSpacing;
        }
        
        // Return a complete Pdf object with all required properties
        return {
            name,
            pages,
            source: arrayBuffer
        };
    } catch (error) {
        console.error("Error loading PDF:", error);
        throw new Error(`Failed to load PDF: ${error.message}`);
    }
}