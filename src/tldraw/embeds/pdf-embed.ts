import { CustomEmbedDefinition } from 'tldraw';
import { Platform } from 'obsidian';
import * as pdfjs from 'pdfjs-dist';

// Initialize PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.js';

export const pdfEmbed: CustomEmbedDefinition = {
  type: 'pdf',
  title: 'PDF Document',
  hostnames: [], // Handle file paths rather than URLs
  minWidth: 500,
  minHeight: 700,
  width: 800,
  height: 1000,
  doesResize: true,
  
  // Handle PDF file paths (blob URLs or data URLs)
  toEmbedUrl: (url: string) => {
    if (url.startsWith('blob:') || url.startsWith('data:application/pdf')) {
      return url;
    }
    // Handle file paths
    if (url.endsWith('.pdf')) {
      return url;
    }
    return undefined;
  },
  
  fromEmbedUrl: (url: string) => url,
  
  // PDF icon
  icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBkPSJNMCA0NjRjMCAyNi41MSAyMS40OSA0OCA0OCA0OGg0MTZjMjYuNTEgMCA0OC0yMS40OSA0OC00OFYyMDBINDAwdjY0YzAgMTMuMjU1LTEwLjc0NSAyNC0yNCAyNEg4OGMtMTMuMjU1IDAtMjQtMTAuNzQ1LTI0LTI0VjEwNGMwLTEzLjI1NSAxMC43NDUtMjQgMjQtMjRoMTEydjEyMEg1MTJWNDhjMC0yNi41MS0yMS40OS00OC00OC00OEg0OEMyMS40OSAwIDAgMjEuNDkgMCA0OHY0MTZ6Ii8+PC9zdmc+',
};