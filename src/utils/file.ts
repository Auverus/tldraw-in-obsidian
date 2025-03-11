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

// export async function loadPdf(name: string, source: ArrayBuffer, resolution: number = 1.5): Promise<Pdf> {
//     const PdfJS = await import('pdfjs-dist');
//     const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;
    
//     try {
//         // Import worker and setup
//         const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
//         PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
        
//         // Load PDF document with optimized settings
//         const pdf = await PdfJS.getDocument({
//             data: source.slice(0),
// //            disableWorker: Platform.isMobile, // Use main thread on mobile
//         }).promise;

//         const canvas = document.createElement('canvas');
//         const context = canvas.getContext('2d', {
//             alpha: false, // No transparency needed for PDF pages
//             willReadFrequently: true // Optimization for frequent pixel reads
//         });
        
//         if (!context) throw new Error('Failed to create canvas context');

//         // Optimize resolution based on device
//         const isMobile = Platform.isMobile;
        
//         // Balance quality and performance
//         const visualScale = isMobile ? Math.min(resolution, 1.0) : resolution;
//         const scale = window.devicePixelRatio;
        
//         let top = 0;
//         let widest = 0;
//         const pages: PdfPage[] = [];
        
//         // Process each page with optimized image generation
//         for (let i = 1; i <= pdf.numPages; i++) {
//             try {
//                 const page = await pdf.getPage(i);
//                 const viewport = page.getViewport({ scale: scale* visualScale });
                
//                 // Limit canvas dimensions (prevents excessive memory use)
//                 const maxDimension = isMobile ? 2048 : 4096;
//                 const canvasScale = Math.min(1, maxDimension / Math.max(viewport.width, viewport.height));
                
//                 canvas.width = viewport.width * canvasScale;
//                 canvas.height = viewport.height * canvasScale;
                
//                 const renderContext = {
//                     canvasContext: context,
//                     viewport: page.getViewport({ 
//                         scale: scale * visualScale * canvasScale
//                     }),
//                     enableWebGL: true, // Use WebGL if available for faster rendering
//                 };
                
//                 await page.render(renderContext).promise;

//                 // Optimize image format and quality based on content
//                 const imageFormat = detectBestImageFormat(context, canvas);
//                 const imageQuality = imageFormat === 'image/jpeg' ? 0.85 : 0.9;
                
//                 const width = viewport.width / scale;
//                 const height = viewport.height / scale;
                
//                 pages.push({
//                     src: canvas.toDataURL(imageFormat, imageQuality),
//                     bounds: new Box(0, top, width, height),
//                     assetId: `asset:${AssetRecordType.createId()}`,
//                     shapeId: createShapeId(),
//                 });
                
//                 top += height + pageSpacing;
//                 widest = Math.max(widest, width);
                
//                 // Clean canvas between pages
//                 context.clearRect(0, 0, canvas.width, canvas.height);
                
//                 // Force garbage collection if too many pages
//                 if (i % 10 === 0 && typeof window.gc === 'function') {
//                     try { window.gc(); } catch (e) {}
//                 }
//             } catch (pageError) {
//                 console.error(`Error rendering page ${i}:`, pageError);
//             }
//         }
        
//         // Clean up resources
//         canvas.width = 0;
//         canvas.height = 0;

//         // Position pages
//         for (const page of pages) {
//             page.bounds.x = (widest - page.bounds.width) / 2;
//         }

//         return {
//             name,
//             pages,
//             source,
//         };
//     } catch (error) {
//         console.error("Failed to process PDF:", error);
//         throw new Error(`Failed to process PDF: ${error.message}`);
//     } finally {
//         PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
//     }
// }

// // Helper function to determine best image format based on content
// function detectBestImageFormat(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): string {
//     // Sample some pixels to detect if the page is mostly text (black/white)
//     // or has complex graphics/images
//     try {
//         const imageData = context.getImageData(0, 0, 
//             Math.min(canvas.width, 100), 
//             Math.min(canvas.height, 100));
        
//         const data = imageData.data;
//         let colorCount = 0;
//         const colors = new Set();
        
//         // Sample pixels to determine complexity
//         for (let i = 0; i < data.length; i += 16) {
//             const r = data[i];
//             const g = data[i + 1];
//             const b = data[i + 2];
//             const colorKey = `${r},${g},${b}`;
//             colors.add(colorKey);
//             if (colors.size > 50) break; // Stop early if we detect many colors
//         }
        
//         // Use WebP for browsers that support it
//         if (canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0) {
//             return 'image/webp';
//         }
        
//         // Simple text pages with few colors work better as PNG
//         // Complex pages with many colors work better as JPEG
//         return colors.size < 20 ? 'image/png' : 'image/jpeg';
//     } catch (e) {
//         // Fallback to JPEG if we can't analyze the image
//         return 'image/jpeg';
//     }
// }


export async function loadPdf(name: string, source: ArrayBuffer, resolution: number = 1.5): Promise<Pdf> {
    const PdfJS = await import('pdfjs-dist');
    const originalWorkerSrc = PdfJS.GlobalWorkerOptions.workerSrc;
    
    try {
        // Import worker and setup
        const PdfWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
        PdfJS.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';
        
        // Load PDF document with optimized settings
        const pdf = await PdfJS.getDocument({
            data: source.slice(0),
//            disableWorker: true // Use main thread for better compatibility
        }).promise;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', {
            alpha: false, // No transparency for better performance
            willReadFrequently: true // Optimize for canvas reads
        });
        
        if (!context) throw new Error('Failed to create canvas context');

        // Optimizations
        const isMobile = window.innerWidth < 1024;
        const visualScale = isMobile ? Math.min(resolution, 1.0) : resolution;
        const scale = window.devicePixelRatio;
        const maxDimension = isMobile ? 2048 : 4096;
        
        let top = 0;
        let widest = 0;
        const pages: PdfPage[] = [];
        
        // Process each page with optimized rendering
        for (let i = 1; i <= pdf.numPages; i++) {
            try {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: scale * visualScale });
                
                // Limit dimensions to prevent memory issues
                const canvasScale = Math.min(1, maxDimension / Math.max(viewport.width, viewport.height));
                
                canvas.width = viewport.width * canvasScale;
                canvas.height = viewport.height * canvasScale;
                
                const renderContext = {
                    canvasContext: context,
                    viewport: page.getViewport({ 
                        scale: scale * visualScale * canvasScale
                    }),
                };
                
                await page.render(renderContext).promise;

                // Choose optimal format based on content type
                const hasColorContent = checkForColor(context, canvas);
                const format = hasColorContent ? 'image/jpeg' : 'image/png';
                const quality = hasColorContent ? 0.85 : undefined;
                
                const width = viewport.width / scale;
                const height = viewport.height / scale;
                
                pages.push({
                    src: canvas.toDataURL(format, quality),
                    bounds: new Box(0, top, width, height),
                    assetId: `asset:${AssetRecordType.createId()}`,
                    shapeId: createShapeId(),
                });
                
                top += height + 32; // pageSpacing
                widest = Math.max(widest, width);
                
                // Clean canvas between pages
                context.clearRect(0, 0, canvas.width, canvas.height);
                
                // Force garbage collection if possible
                if (i % 5 === 0 && typeof window.gc === 'function') {
                    try { window.gc(); } catch (e) {}
                }
            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
            }
        }
        
        // Clean up resources
        canvas.width = 0;
        canvas.height = 0;

        // Position pages
        for (const page of pages) {
            page.bounds.x = (widest - page.bounds.width) / 2;
        }

        return { name, pages, source };
    } finally {
        PdfJS.GlobalWorkerOptions.workerSrc = originalWorkerSrc;
    }
}

// Add this helper function
function checkForColor(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
    try {
        // Sample pixels to check if it's mostly text (black/white) or has color
        const sampleSize = Math.min(canvas.width, canvas.height) / 4;
        const imageData = context.getImageData(
            canvas.width/2 - sampleSize/2, 
            canvas.height/2 - sampleSize/2,
            sampleSize, sampleSize
        );
        
        const data = imageData.data;
        let coloredPixels = 0;
        
        // Check for non-grayscale pixels (R != G != B)
        for (let i = 0; i < data.length; i += 16) { // Sample every 4th pixel for performance
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // If RGB values differ by more than 5, consider it a color pixel
            if (Math.abs(r - g) > 5 || Math.abs(r - b) > 5 || Math.abs(g - b) > 5) {
                coloredPixels++;
            }
        }
        
        // If more than 5% of sampled pixels are colored, use JPEG
        return coloredPixels > (data.length / 16) * 0.05;
    } catch (e) {
        return false; // Default to false if we can't analyze
    }
}