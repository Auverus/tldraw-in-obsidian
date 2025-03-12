import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

interface PdfEmbedComponentProps {
  url: string;
  width: number;
  height: number;
}

export const PdfEmbedComponent: React.FC<PdfEmbedComponentProps> = ({ url, width, height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loaded, setLoaded] = useState(false);
  
  // Load PDF document
  useEffect(() => {
    const loadPdf = async () => {
      try {
        // Handle different URL types
        let source;
        if (url.startsWith('blob:') || url.startsWith('data:application/pdf')) {
          source = { url };
        } else {
          // Fetch PDF from file path
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          source = { data: arrayBuffer };
        }
        
        const pdf = await pdfjs.getDocument(source).promise;
        setPdfDocument(pdf);
        setPageCount(pdf.numPages);
        setLoaded(true);
      } catch (error) {
        console.error('Failed to load PDF:', error);
      }
    };
    
    loadPdf();
    
    return () => {
      // Clean up PDF document when component unmounts
      if (pdfDocument) {
        pdfDocument.destroy();
      }
    };
  }, [url]);
  
  // Render all pages when document is loaded or container size changes
  useEffect(() => {
    if (!pdfDocument || !containerRef.current) return;
    
    const renderPages = async () => {
      const container = containerRef.current;
      if (!container) return;
      
      // Clear container
      container.innerHTML = '';
      
      // Calculate optimal scale to fit width
      const containerWidth = width - 20; // Account for padding
      
      // Create wrapper for all pages
      const pagesContainer = document.createElement('div');
      pagesContainer.className = 'pdf-pages-container';
      container.appendChild(pagesContainer);
      
      // Track total height for container sizing
      let totalHeight = 0;
      
      // Render each page
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdfDocument.getPage(i);
        const viewport = page.getViewport({ scale });
        
        // Adjust scale to fit width if needed for the first page
        if (i === 1 && viewport.width > containerWidth) {
          const newScale = containerWidth / viewport.width;
          setScale(newScale);
          // Re-render with adjusted scale
          return;
        }
        
        const pageContainer = document.createElement('div');
        pageContainer.className = 'pdf-page';
        pageContainer.style.marginBottom = '10px';
        pagesContainer.appendChild(pageContainer);
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        pageContainer.appendChild(canvas);
        totalHeight += viewport.height + 10; // Add page height + margin
        
        // Render page on canvas
        await page.render({
          canvasContext: context!,
          viewport,
        }).promise;
        
        // Create annotation layer
        const annotationLayer = document.createElement('div');
        annotationLayer.className = 'annotation-layer';
        pageContainer.appendChild(annotationLayer);
        
        // Position annotation layer over the page
        annotationLayer.style.position = 'absolute';
        annotationLayer.style.top = '0';
        annotationLayer.style.left = '0';
        annotationLayer.style.width = `${viewport.width}px`;
        annotationLayer.style.height = `${viewport.height}px`;
      }
      
      // Update container height to fit all pages
      container.style.height = `${totalHeight}px`;
    };
    
    renderPages();
  }, [pdfDocument, pageCount, scale, width, height]);
  
  return (
    <div 
      className="pdf-embed-container" 
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '100%', 
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#f8f9fa'
      }}
    >
      {!loaded && <div className="loading-indicator">Loading PDF...</div>}
    </div>
  );
};
