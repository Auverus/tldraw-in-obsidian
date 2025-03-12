import { 
    BaseBoxShapeUtil, 
    HTMLContainer, 
    TLBaseShape, 
    toDomPrecision, 
    TLAssetId 
  } from "tldraw"
  import * as React from 'react'
  import * as pdfjsLib from 'pdfjs-dist'
  import { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
  
  // Define custom PDF viewer shape
  export type PdfViewerShape = TLBaseShape<
    'pdfViewer',
    {
      w: number
      h: number
      pdfSource: string | ArrayBuffer // PDF data or URL
      currentPage: number
      scale: number
    }
  >
  
  export class PdfViewerShapeUtil extends BaseBoxShapeUtil<PdfViewerShape> {
    static override type = 'pdfViewer'
  
    getDefaultProps(): PdfViewerShape['props'] {
      return {
        w: 800,
        h: 1000,
        pdfSource: '',
        currentPage: 1,
        scale: 1.0
      }
    }
    
    indicator(shape: PdfViewerShape) {
      return <rect width={toDomPrecision(shape.props.w)} height={toDomPrecision(shape.props.h)} />
    }
    
    component(shape: PdfViewerShape) {
      return (
        <HTMLContainer>
          <PdfViewer 
            source={shape.props.pdfSource}
            currentPage={shape.props.currentPage}
            scale={shape.props.scale}
            width={shape.props.w}
            height={shape.props.h}
            editor={this.editor}
            shapeId={shape.id}
          />
        </HTMLContainer>
      )
    }
  }
  
  // PDF Viewer Component that directly uses PDF.js
  function PdfViewer({ 
    source, 
    currentPage, 
    scale, 
    width, 
    height, 
    editor, 
    shapeId 
  }: { 
    source: string | ArrayBuffer;
    currentPage: number;
    scale: number;
    width: number;
    height: number;
    editor: any;
    shapeId: string;
  }) {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null)
    const [renderedPages, setRenderedPages] = React.useState<Set<number>>(new Set())
    const [totalPages, setTotalPages] = React.useState<number>(0)
    
    // Load PDF on mount
    React.useEffect(() => {
      let isActive = true
      
      async function loadPdf() {
        if (!source) return
        
        try {
          // Set worker source
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js'
          
          // Load PDF
          const pdfDoc = await pdfjsLib.getDocument(
            typeof source === 'string' ? { url: source } : { data: source }
          ).promise
          
          if (isActive) {
            setPdf(pdfDoc)
            setTotalPages(pdfDoc.numPages)
          }
        } catch (err) {
          console.error('Error loading PDF:', err)
        }
      }
      
      loadPdf()
      
      return () => {
        isActive = false
        // Cleanup PDF document
        if (pdf) pdf.destroy()
      }
    }, [source])
    
    // Render current page and visible neighbors
    React.useEffect(() => {
      if (!pdf || !containerRef.current) return
      
      const renderPage = async (pageNum: number) => {
        if (renderedPages.has(pageNum) || pageNum < 1 || pageNum > totalPages) return
        
        try {
          const page = await pdf.getPage(pageNum)
          const viewport = page.getViewport({ scale })
          
          // Create canvas for this page
          const canvas = document.createElement('canvas')
          const canvasId = `pdf-page-${pageNum}`
          canvas.id = canvasId
          canvas.className = 'pdf-page'
          canvas.dataset.pageNumber = pageNum.toString()
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.position = 'absolute'
          canvas.style.top = `${(pageNum - 1) * (viewport.height + 20)}px`
          canvas.style.left = '0'
          canvas.style.margin = '0 auto'
          canvas.style.display = 'block'
          
          // Add to container
          if (containerRef.current) {
            const existingCanvas = containerRef.current.querySelector(`#${canvasId}`)
            if (existingCanvas) existingCanvas.remove()
            containerRef.current.appendChild(canvas)
          }
          
          // Render PDF page to canvas
          await page.render({
            canvasContext: canvas.getContext('2d')!,
            viewport
          }).promise
          
          setRenderedPages(prev => new Set([...prev, pageNum]))
        } catch (err) {
          console.error(`Error rendering page ${pageNum}:`, err)
        }
      }
      
      // Render current page and neighbors
      if (totalPages >= currentPage) {
        renderPage(currentPage)
        if (currentPage > 1) renderPage(currentPage - 1)
        if (currentPage < totalPages) renderPage(currentPage + 1)
      }
      
      // Set up scroll handler to render pages as they become visible
      const handleScroll = debounce(() => {
        if (!containerRef.current || !pdf) return
        
        const containerRect = containerRef.current.getBoundingClientRect()
        const containerHeight = containerRef.current.clientHeight
        const scrollTop = containerRef.current.scrollTop
        
        const visibleStart = scrollTop
        const visibleEnd = scrollTop + containerHeight
        
        // Estimate which pages are visible
        const pageHeight = containerHeight / 1.5 + 20 // Rough estimate with spacing
        const firstVisiblePage = Math.max(1, Math.floor(visibleStart / pageHeight) + 1)
        const lastVisiblePage = Math.min(totalPages, Math.ceil(visibleEnd / pageHeight) + 1)
        
        // Render visible pages and some before/after for smooth scrolling
        for (let i = Math.max(1, firstVisiblePage - 1); i <= Math.min(totalPages, lastVisiblePage + 1); i++) {
          renderPage(i)
        }
        
        // Update current page for navigation
        if (editor && containerRef.current) {
          const centerY = scrollTop + containerHeight / 2
          const currentVisiblePage = Math.ceil(centerY / pageHeight)
          
          if (currentVisiblePage !== currentPage && currentVisiblePage >= 1 && currentVisiblePage <= totalPages) {
            editor.updateShape({
              id: shapeId,
              type: 'pdfViewer',
              props: {
                currentPage: currentVisiblePage
              }
            })
          }
        }
      }, 100)
      
      // Add scroll listener
      const container = containerRef.current
      container.addEventListener('scroll', handleScroll)
      
      // Initial render
      handleScroll()
      
      return () => {
        container.removeEventListener('scroll', handleScroll)
      }
    }, [pdf, currentPage, scale, renderedPages, totalPages, editor, shapeId])
  
    return (
      <div 
        ref={containerRef} 
        style={{ 
          width: '100%', 
          height: '100%', 
          overflow: 'auto',
          position: 'relative',
          backgroundColor: '#f8f8f8'
        }}
      >
        {!pdf && <div className="pdf-loading">Loading PDF...</div>}
        {pdf && totalPages > 0 && (
          <div className="pdf-controls" style={{
            position: 'absolute',
            bottom: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            backgroundColor: 'rgba(255,255,255,0.8)',
            padding: '5px 10px',
            borderRadius: '4px',
            display: 'flex',
            gap: '10px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <span>{currentPage} / {totalPages}</span>
          </div>
        )}
      </div>
    )
  }
  
  // Helper function for debouncing
  function debounce(fn: Function, delay: number) {
    let timeoutId: number | null = null;
    return function(...args: any[]) {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), delay);
    };
  }