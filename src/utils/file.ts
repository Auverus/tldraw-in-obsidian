import {
	TLUiActionItem,
	TLDRAW_FILE_EXTENSION,
	serializeTldrawJsonBlob,
	Editor,
	useDefaultHelpers,
	Box,
	TLAssetId,
	TLShapeId,
	createShapeId,
	AssetRecordType
} from "tldraw";
import TldrawPlugin from "src/main";
import { migrateTldrawFileDataIfNecessary } from "./migrate/tl-data-to-tlstore";
import { Platform, TFile } from "obsidian";
import { showSaveFileModal } from "src/obsidian/modal/save-file-modal";
// import { shouldOverrideDocument } from "src/components/file-menu/shouldOverrideDocument";
// PDF.js worker is dynamically imported in loadPdf function
export const SAVE_FILE_COPY_ACTION = "save-file-copy";
export const SAVE_FILE_COPY_IN_VAULT_ACTION = "save-file-copy-in-vault";
export const OPEN_FILE_ACTION = 'open-file';
export const OPEN_PDF_ACTION = 'open-pdf';
// https://github.com/tldraw/tldraw/blob/58890dcfce698802f745253ca42584731d126cc3/packages/tldraw/src/lib/utils/export/exportAs.ts#L57
const downloadFile = (file: File) => {
	const link = document.createElement("a");
	const url = URL.createObjectURL(file);
	link.href = url;
	link.download = file.name;
	link.click();
	URL.revokeObjectURL(url);
};

export function downloadBlob(blob: Blob, name: string, plugin: TldrawPlugin, preferVault: boolean = false) {
	const file = new File([blob], name, {
		type: blob.type,
	});
	if (Platform.isMobile || preferVault) {
		return showSaveFileModal(plugin, file, {});
	} else {
		return downloadFile(file);
	}
}

// https://github.com/tldraw/tldraw/blob/58890dcfce698802f745253ca42584731d126cc3/apps/dotcom/src/utils/useFileSystem.tsx#L111
export function getSaveFileCopyAction(
	editor: Editor,
	defaultDocumentName: string,
): TLUiActionItem {
	if (Platform.isMobile) {
		throw new Error(`${getSaveFileCopyAction.name} is not allowed on mobile platforms.`);
	}
	return {
		id: SAVE_FILE_COPY_ACTION,
		label: "action.save-copy",
		readonlyOk: true,
		async onSelect() {
			const defaultName = `${defaultDocumentName}${TLDRAW_FILE_EXTENSION}`;

			const blobToSave = await serializeTldrawJsonBlob(editor);

			try {
				const file = new File([blobToSave], defaultName, {
					type: blobToSave.type,
				});
				downloadFile(file);
			} catch (e) {
				// user cancelled
				return;
			}
		},
	};
}

export function getSaveFileCopyInVaultAction(
	editor: Editor,
	defaultDocumentName: string,
	plugin: TldrawPlugin,
): TLUiActionItem {
	const defaultName = `${defaultDocumentName}${TLDRAW_FILE_EXTENSION}`;
	return {
		id: SAVE_FILE_COPY_IN_VAULT_ACTION,
		label: "Save a copy in vault",
		readonlyOk: true,
		onSelect: async () => {
			const res = await downloadBlob(
				await serializeTldrawJsonBlob(editor),
				defaultName,
				plugin,
				true
			)

			if(typeof res === 'object') {
				res.showResultModal()
			}
		},
	};
}

export function importFileAction(plugin: TldrawPlugin,
	addDialog: ReturnType<typeof useDefaultHelpers>['addDialog']
): TLUiActionItem {
	return {
		id: OPEN_FILE_ACTION,
		label: "action.open-file",
		readonlyOk: true,
		async onSelect(source) {
			const tFile = await importTldrawFile(plugin);
			await plugin.openTldrFile(tFile, 'new-tab');
		},
	};
}
// export function importPDFAction(plugin: TldrawPlugin,
// 	addDialog: ReturnType<typeof useDefaultHelpers>['addDialog']
// ): TLUiActionItem {
// 	return {
// 		id: OPEN_PDF_ACTION,
// 		label: "Open PDF",
// 		readonlyOk: true,
// 		async onSelect(source) {
// 			const [fileHandle] = await window.showOpenFilePicker({
// 				types: [
// 					{
// 						description: 'PDF Document',
// 						accept: {
// 							'application/pdf': ['.pdf']
// 						}
// 					}
// 				],
// 				excludeAcceptAllOption: true,
// 			});

// 			const file = await fileHandle.getFile();
// 			const arrayBuffer = await file.arrayBuffer();
// 			const pdf = await loadPdf(file.name, arrayBuffer);

// 			// Opening the PDF with the required parameters
// 			await plugin.openPDF(pdf.source, 'new-tab');
// 		},
// 	};
// }

export function importPDFAction(plugin: TldrawPlugin,
    addDialog: ReturnType<typeof useDefaultHelpers>['addDialog']
): TLUiActionItem {
    return {
        id: OPEN_PDF_ACTION,
        label: "Open PDF",
        readonlyOk: true,
        async onSelect(source) {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [
                    {
                        description: 'PDF Document',
                        accept: {
                            'application/pdf': ['.pdf']
                        }
                    }
                ],
                excludeAcceptAllOption: true,
            });

            const file = await fileHandle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await loadPdf(file.name, arrayBuffer);

            // Pass the entire pdf object, not just the source
            await plugin.openPDF(pdf, 'new-tab');
        },
    };
}
export async function importTldrawFile(plugin: TldrawPlugin, attachTo?: TFile) {
	if ('showOpenFilePicker' in window) {
		const [file] = await window.showOpenFilePicker({
			id: 'tldraw-open-file',
			startIn: 'downloads',
			types: [
				{
					description: 'Tldraw Document',
					accept: {
						'text/tldr': ['.tldr']
					}
				}
			],
			excludeAcceptAllOption: true,
		});

		return plugin.createUntitledTldrFile({
			attachTo,
			tlStore: migrateTldrawFileDataIfNecessary(await (
				await file.getFile()
			).text())
		})
	} else {
		throw new Error('Unable to open file picker.');
	}
}


//https://tldraw.dev/examples/use-cases/pdf-editor
export interface PdfPage {
	src: string
	bounds: Box
    assetId: `asset:${string}` // Update the type to match the "asset:" prefix requirement
	// 	//assetId: TLAssetId
	shapeId: TLShapeId
}

export interface Pdf {
	name: string
	pages: PdfPage[]
	source: string | ArrayBuffer
}

const pageSpacing = 32
// export async function loadPdf(name: string, source: ArrayBuffer): Promise<Pdf> {
// 	const PdfJS = await import('pdfjs-dist')
// 	// Import the worker directly from the package
// 	// Set the worker to use the imported worker
// 	const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
// 	PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
// 	const pdf = await PdfJS.getDocument(source.slice(0)).promise

// 	const canvas = window.document.createElement('canvas')
// 	const context = canvas.getContext('2d')
// 	if (!context) throw new Error('Failed to create canvas context')

// 	const visualScale = 1.5
// 	const scale = window.devicePixelRatio

// 	let top = 0
// 	let widest = 0
// 	const pages: PdfPage[] = []
// 	for (let i = 1; i <= pdf.numPages; i++) {
// 		const page = await pdf.getPage(i)
// 		const viewport = page.getViewport({ scale: scale * visualScale })
// 		canvas.width = viewport.width
// 		canvas.height = viewport.height
// 		const renderContext = {
// 			canvasContext: context,
// 			viewport,
// 		}
// 		await page.render(renderContext).promise

// 		const width = viewport.width / scale
// 		const height = viewport.height / scale
// 		pages.push({
// 			src: canvas.toDataURL(),
// 			bounds: new Box(0, top, width, height),
// 			assetId: AssetRecordType.createId(),
// 			shapeId: createShapeId(),
// 		})
// 		top += height + pageSpacing
// 		widest = Math.max(widest, width)
// 	}
// 	canvas.width = 0
// 	canvas.height = 0

// 	for (const page of pages) {
// 		page.bounds.x = (widest - page.bounds.width) / 2
// 	}

// 	return {
// 		name,
// 		pages,
// 		source,
// 	}
// }
// export async function loadPdf(name: string, source: ArrayBuffer): Promise<Pdf> {
//     const PdfJS = await import('pdfjs-dist')
//     // Import the worker directly from the package
//     // Set the worker to use the imported worker
//      const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
// //	const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;   
// // 	PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
// //    const pdf = await PdfJS.getDocument(source.slice(0)).promise
// // 	console.log(originalWorkerSrc);
// //let PdfJS: any = null;
// //let PdfWorker: any = null;
// let pdf: any = null;

// const originalPdfjsLib = (window as any).PdfJS;
// const originalGlobalWorkerOptions = (window as any).PdfJS;//GlobalWorkerOptions;
// //const originalWorkerSrc = (globalThis as any).pdfjsLib?.GlobalWorkerOptions?.workerSrc;
// 	//const worker = new PdfJS.PDFWorker();
// try{    
//     // Use the worker directly in the document loading options
//     // const pdf = await PdfJS.getDocument({
//     //     data: source.slice(0),
//     //     worker: worker
//     // }).promise;
// 	//const pdf = await PdfJS.getDocument(source.slice(0)).promise;
// //         PdfJS = await import('pdfjs-dist');
// // PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');

// // Save original worker source
// //console.log("Original worker source:", originalWorkerSrc);

// // Set up a worker for this specific operation
// // PdfJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.0/pdf.worker.min.js';
// //PdfJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.0/pdf.worker.min.js';
// // Process PDF
// 	pdf = await PdfJS.getDocument({
// 	data: source.slice(0),
// //	disableWorker: true // Use worker for better performance
// }).promise;
//     const canvas = window.document.createElement('canvas')
//     const context = canvas.getContext('2d')
//     if (!context) throw new Error('Failed to create canvas context')

//     const visualScale = 1.5
//     const scale = window.devicePixelRatio

//     let top = 0
//     let widest = 0
//     const pages: PdfPage[] = []
//     for (let i = 1; i <= pdf.numPages; i++) {
//         const page = await pdf.getPage(i)
//         const viewport = page.getViewport({ scale: scale * visualScale })
//         canvas.width = viewport.width
//         canvas.height = viewport.height
//         const renderContext = {
//             canvasContext: context,
//             viewport,
//         }
//         await page.render(renderContext).promise

//         const width = viewport.width / scale
//         const height = viewport.height / scale
//         pages.push({
//             src: canvas.toDataURL(),
//             bounds: new Box(0, top, width, height),
//             assetId: `asset:${AssetRecordType.createId()}`, // Add "asset:" prefix here
//             shapeId: createShapeId(),
//         })
//         top += height + pageSpacing
//         widest = Math.max(widest, width)
//     }
//     canvas.width = 0
//     canvas.height = 0

//     for (const page of pages) {
//         page.bounds.x = (widest - page.bounds.width) / 2
//     }

//     return {
//         name,
//         pages,
//         source,
//     }
// }finally {
// 	// Always destroy the worker when done, even if there's an error
// 	//worker.destroy();
// 	// console.log('Destroying PDF worker');

//     // PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;

// 	// try {
// 	// 	// Restore original worker source
// 	// 	if (PdfJS && originalWorkerSrc !== undefined) {
// 	// 		PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
// 	// 	} else if (PdfJS) {
// 	// 		// If no original value, set to undefined to remove it
// 	// 		PdfJS.GlobalWorkerOptions.workerSrc = undefined;
// 	// 	}
		
// 	// 	// Close the document if it exists
// 	// 	if (pdf) {
// 	// 		pdf.cleanup();
// 	// 		pdf.destroy();
// 	// 	}
		
// 	// 	// Attempt to help garbage collection by removing references
// 	// 	pdf = null;
// 	// 	PdfJS = null;
// 	// 	PdfWorker = null;
		
// 	// 	// Force garbage collection if possible (though this may not work in all browsers)
// 	// 	if (typeof window.gc === 'function') {
// 	// 		try {
// 	// 			window.gc();
// 	// 		} catch (e) {
// 	// 			console.log("Failed to force garbage collection");
// 	// 		}
// 	// 	}
		
// 	// 	console.log('PDF.js resources cleanup attempted');
// 	// } catch (cleanupError) {
// 	// 	console.error('Error during PDF.js cleanup:', cleanupError);
// 	// }

// 	// if (PdfJS) {
// 	// 	PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
// 	// }

// 	if (originalPdfjsLib) {
// 		(window as any).PdfJS = originalPdfjsLib;
// 		if (originalGlobalWorkerOptions) {
// 			(window as any).PdfJS.GlobalWorkerOptions = originalGlobalWorkerOptions;
// 		}
// 	} else {
// 		// If Obsidian didn't have pdfjsLib set up yet, remove our version
// 		delete (window as any).PdfJS;
// 	}
// }}

// export async function loadPdf(name: string, source: ArrayBuffer, resolution: number = 1.5): Promise<Pdf> {
//     const PdfJS = await import('pdfjs-dist')
    
//     // Save the original worker source to restore later
//     const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;
    
//     try {
//         // Use a CDN URL that will work in Obsidian's environment
//     const PdfJS = await import('pdfjs-dist')
//     // Import the worker directly from the package
//     // Set the worker to use the imported worker
//      const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
// //	const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;   
// // 	PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
// //    const pdf = await PdfJS.getDocument(source.slice(0)).promise
// // 	console.log(originalWorkerSrc);
        
//         // Process in main thread without worker to avoid conflicts
//         const pdf = await PdfJS.getDocument({
//             data: source.slice(0),
//      //       disableWorker: true  // Process in main thread
//         }).promise;

//         const canvas = document.createElement('canvas');
//         const context = canvas.getContext('2d');
//         if (!context) throw new Error('Failed to create canvas context');

//         // Use the provided resolution instead of hardcoded value
//         const visualScale = resolution;
//         const scale = window.devicePixelRatio;

//         let top = 0;
//         let widest = 0;
//         const pages: PdfPage[] = [];
        
//         // Process each page
//         for (let i = 1; i <= pdf.numPages; i++) {
//             const page = await pdf.getPage(i);
//             const viewport = page.getViewport({ scale: scale * visualScale });
//             canvas.width = viewport.width;
//             canvas.height = viewport.height;
            
//             const renderContext = {
//                 canvasContext: context,
//                 viewport,
//             };
//             await page.render(renderContext).promise;

//             const width = viewport.width / scale;
//             const height = viewport.height / scale;
            
//             pages.push({
//                 src: canvas.toDataURL(),
//                 bounds: new Box(0, top, width, height),
//                 assetId: `asset:${AssetRecordType.createId()}`,
//                 shapeId: createShapeId(),
//             });
            
//             top += height + pageSpacing;
//             widest = Math.max(widest, width);
//         }
        
//         canvas.width = 0;
//         canvas.height = 0;

//         for (const page of pages) {
//             page.bounds.x = (widest - page.bounds.width) / 2;
//         }

//         return {
//             name,
//             pages,
//             source,
//         };
//     } finally {
//         // Restore the original worker source
//         PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
//     }
// }

export async function loadPdf(name: string, source: ArrayBuffer, resolution: number = 1.5): Promise<Pdf> {
    const PdfJS = await import('pdfjs-dist');
    
    // Save the original worker source to restore later
    const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;
    
    try {
        // Set worker source using CDN
//	const PdfJS = await import('pdfjs-dist')
	// Import the worker directly from the package
	// Set the worker to use the imported worker
	const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
	PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
	const pdf = await PdfJS.getDocument(source.slice(0)).promise

        
//         // Process PDF in main thread for better compatibility
//         const pdf = await PdfJS.getDocument({
//             data: source.slice(0),
// //            disableWorker: true  // Process in main thread for better mobile compatibility
//         }).promise;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Failed to create canvas context');

        // Check if we're on mobile and adjust resolution if needed
	const isMobile = Platform.isMobile;
        
        // Use lower resolution on mobile devices
       const visualScale = isMobile ? Math.min(resolution, 1.0) : resolution;
        const scale = window.devicePixelRatio;

        let top = 0;
        let widest = 0;
        const pages: PdfPage[] = [];
        const pageSpacing = 32;
        
        // Process each page
        for (let i = 1; i <= pdf.numPages; i++) {
            try {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: scale * visualScale });
                
                // // For mobile devices, ensure canvas size is reasonable
                // if (isMobile && (viewport.width > 2048 || viewport.height > 2048)) {
                //     const scaleFactor = 2048 / Math.max(viewport.width, viewport.height);
                //     viewport.width *= scaleFactor;
                //     viewport.height *= scaleFactor;
                // }
                
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                const renderContext = {
                    canvasContext: context,
                    viewport,
                };
                
                await page.render(renderContext).promise;

                // For mobile, use lower JPEG quality instead of PNG
                const imageType = isMobile ? 'image/jpeg' : 'image/png';
                const imageQuality = isMobile ? 0.7 : 1.0;
                
                const width = viewport.width / scale;
                const height = viewport.height / scale;
                
                pages.push({
                    src: canvas.toDataURL(imageType, imageQuality),
                    bounds: new Box(0, top, width, height),
                    assetId: `asset:${AssetRecordType.createId()}`,
                    shapeId: createShapeId(),
                });
                
                top += height + pageSpacing;
                widest = Math.max(widest, width);
                
                // Clean up canvas between pages to save memory
                context.clearRect(0, 0, canvas.width, canvas.height);
            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
                // Continue with other pages if possible
            }
        }
        
        // Clean up canvas
        canvas.width = 0;
        canvas.height = 0;

        // Position pages
        for (const page of pages) {
            page.bounds.x = (widest - page.bounds.width) / 2;
        }

        return {
            name,
            pages,
            source,
        };
    } catch (error) {
        console.error("Failed to process PDF:", error);
        throw new Error(`Failed to process PDF: ${error.message}`);
    } finally {
        // Restore original worker source
        PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
    }
}