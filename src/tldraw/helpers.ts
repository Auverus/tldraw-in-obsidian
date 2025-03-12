import { TLDataDocument, TLDataDocumentStore, TldrawPluginMetaData } from "src/utils/document";
import { TLStore, createTLStore, defaultShapeUtils } from "tldraw";
import { PdfPageShapeUtil } from "./PdfPageShape";

export function processInitialData(initialData: TLDataDocument): TLDataDocumentStore {
	const { meta, store }: {
		meta: TldrawPluginMetaData,
		store: TLStore,
	} = (() => {
		if (initialData.store) {
			return initialData;
		}

		return {
			meta: initialData.meta,
			store: createTLStore({
				shapeUtils: [...defaultShapeUtils, PdfPageShapeUtil],  // This is correctly adding the shape
				initialData: initialData.raw,
			  })
		}
	})();

	return { meta, store };
}
