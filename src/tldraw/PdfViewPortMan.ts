import { Editor, TLAssetId } from "tldraw"
import { debounce } from "obsidian"
import { PdfPageShape } from "./PdfPageShape" // Import your shape type

export class PdfViewportManager {
  private editor: Editor
  private visibilityCheckInterval: number | null = null
  private assetCache: Map<string, string> = new Map()
  private unsubscribe: (() => void) | null = null
  
  constructor(editor: Editor) {
    this.editor = editor
    
    // Use 'update' event instead of 'viewportchange'
    const handleUpdate = debounce(this.updateQualityBasedOnZoom.bind(this), 100)
    this.editor.on('frame', handleUpdate)
    
    // Save the unsubscribe function for cleanup
    this.unsubscribe = () => {
      this.editor.off('frame', handleUpdate)
    }
  }
  
  start() {
    this.visibilityCheckInterval = window.setInterval(() => {
      this.updateQualityBasedOnZoom()
    }, 1000)
    
    this.updateQualityBasedOnZoom()
  }
  
  stop() {
    if (this.visibilityCheckInterval) {
      clearInterval(this.visibilityCheckInterval)
      this.visibilityCheckInterval = null
    }
    
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }
  
  private updateQualityBasedOnZoom() {
    // Get zoom from camera instead of using getZoom()
    const zoom = this.editor.getCamera().z
    
    // Find all PDF page shapes
    const pdfPages = this.editor.getCurrentPageShapes()
      .filter(shape => shape.type === 'pdfPage')
    
    // Update quality based on zoom level
    pdfPages.forEach(shape => {
      // Type assertion to tell TypeScript this is a PdfPageShape
      const pdfShape = shape as unknown as PdfPageShape
      
      // Low quality when zoomed out, high quality when zoomed in
      const quality = zoom < 0.8 ? 'low' : zoom > 1.5 ? 'high' : 'medium'
      
      // First check if the quality prop exists and is different
      if (pdfShape.props && 
          'quality' in pdfShape.props && 
          pdfShape.props.quality !== quality) {
        
        this.editor.updateShape({
          id: shape.id,
          type: 'pdfPage',
          props: {
            ...pdfShape.props,
            quality
          }
        })
      }
    })
  }
}