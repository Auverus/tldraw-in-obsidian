import { 
  BaseBoxShapeUtil, 
  HTMLContainer, 
  TLBaseShape, 
  toDomPrecision, 
  TLAssetId,
  getDefaultColorTheme
} from "tldraw"
import * as React from 'react'

// Define custom PDF page shape
export type PdfPageShape = TLBaseShape<
  'pdfPage',
  {
    w: number
    h: number
    assetId: string
    pageNumber: number
    pdfId: string
    quality: 'low' | 'medium' | 'high'
  }
>

export class PdfPageShapeUtil extends BaseBoxShapeUtil<PdfPageShape> {
  static override type = 'pdfPage'

  getDefaultProps(): PdfPageShape['props'] {
    return {
      w: 1,
      h: 1,
      assetId: '',
      pageNumber: 1,
      pdfId: '',
      quality: 'medium'
    }
  }
  
  // Add this required indicator method
  indicator(shape: PdfPageShape) {
    return <rect width={toDomPrecision(shape.props.w)} height={toDomPrecision(shape.props.h)} />
  }
  
  component(shape: PdfPageShape) {
    // Cast string to TLAssetId type
    const assetId = shape.props.assetId as TLAssetId
    const asset = this.editor.getAsset(assetId)
    const { pageNumber } = shape.props
    
    // Get zoom from camera
    const zoom = this.editor.getCamera().z
    
    return (
      <HTMLContainer>
        {asset && asset.props.src ? (
          <img 
            src={asset.props.src}
            alt={`PDF page ${pageNumber}`}
            width={toDomPrecision(shape.props.w)}
            height={toDomPrecision(shape.props.h)}
            style={{
              objectFit: 'contain',
              width: '100%', 
              height: '100%'
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#f8f8f8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px'
          }}>
            Loading page {pageNumber}...
          </div>
        )}
      </HTMLContainer>
    )
  }
}