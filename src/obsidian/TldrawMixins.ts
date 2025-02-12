import { FileView, TFile } from "obsidian";
import { Root } from "react-dom/client";
import TldrawPlugin from "src/main";
import { MARKDOWN_ICON_NAME, VIEW_TYPE_MARKDOWN } from "src/utils/constants";
import { createRootAndRenderTldrawApp, TldrawAppProps, TldrawAppStoreProps } from "src/components/TldrawApp";
import TldrawAssetsModal from "./modal/TldrawAssetsModal";

/**
 * Implements overrides for {@linkcode FileView.onload} and {@linkcode FileView.onunload}
 * as a mixin so that it could be reused.
 * 
 * @param Base 
 * @returns 
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TldrawLoadableMixin<T extends abstract new (...args: any[]) => FileView>(Base: T) {
    /**
     * #NOTE: may need to embed the react root in an iframe so that the right click context menus are positioned within the frame, and not partially hidden.
     */
    abstract class _TldrawLoadableMixin extends Base {
        abstract plugin: TldrawPlugin;
        private reactRoot?: Root;
        private onUnloadCallbacks: (() => void)[] = [];

        #storeProps?: TldrawAppStoreProps;

        #unregisterViewAssetsActionCallback?: () => void;
        #unregisterOnWindowMigrated?: () => void;

        protected get tldrawContainer() { return this.containerEl.children[1]; }

        /**
         * Adds the entry point `tldraw-view-content` for the {@linkcode reactRoot},
         * and the "View as markdown" action button.
         */
        override onload(): void {
            super.onload();
            this.contentEl.addClass("tldraw-view-content");

            this.#unregisterOnWindowMigrated?.();
            this.#unregisterOnWindowMigrated = this.contentEl.onWindowMigrated(() => {
                this.refreshView();
            })

            this.addAction(MARKDOWN_ICON_NAME, "View as markdown", () => this.viewAsMarkdownClicked());
        }

        /**
         * Removes the previously added entry point `tldraw-view-content`, and unmounts {@linkcode reactRoot}.
         */
        override onunload(): void {
            this.#unregisterOnWindowMigrated?.();
            this.contentEl.removeClass("tldraw-view-content");
            this.unmountReactRoot();
            super.onunload();
        }

        override onUnloadFile(file: TFile): Promise<void> {
            const callbacks = [...this.onUnloadCallbacks];
            this.onUnloadCallbacks = [];
            callbacks.forEach((e) => e());
            return super.onUnloadFile(file);
        }

        public registerOnUnloadFile(cb: () => void) {
            this.onUnloadCallbacks.push(cb);
        }

        protected getTldrawOptions(): TldrawAppProps['options'] {
            return {
                onEditorMount: (editor) => editor.zoomToFit()
            };
        }

        private createReactRoot(entryPoint: Element, store: TldrawAppStoreProps) {
            return createRootAndRenderTldrawApp(
                entryPoint,
                this.plugin,
                {
                    app: this.getTldrawOptions(),
                    store,
                }
            );
        }

        /**
         * Set the store props to be used inside the react root element.
         * @param storeProps 
         * @returns 
         */
        protected async setStore(storeProps?: TldrawAppStoreProps) {
            this.#storeProps = storeProps;
            this.updateViewAssetsAction();
            this.refreshView();
        }

        protected viewAsMarkdownClicked() {
            this.plugin.updateViewMode(VIEW_TYPE_MARKDOWN);
        }

        private updateViewAssetsAction() {
            const storeProps = this.#storeProps;
            this.#unregisterViewAssetsActionCallback?.();
            if (!storeProps) return;

            const viewAssetsAction = this.addAction('library', 'View assets', () => {
                const assetsModal = new TldrawAssetsModal(this.app, storeProps, this.file)
                assetsModal.open();
                this.registerOnUnloadFile(() => assetsModal.close());
            });

            const removeCb = () => {
                viewAssetsAction.remove()
            };
            this.registerOnUnloadFile(removeCb);
            this.#unregisterViewAssetsActionCallback = () => {
                console.log('unregisterViewAssetsActionCallback')
                this.onUnloadCallbacks.remove(removeCb);
                removeCb();
            }
        }

        private unmountReactRoot() {
            this.reactRoot?.unmount();
            this.reactRoot = undefined;
        }

        async refreshView() {
            const storeProps = this.#storeProps;
            this.unmountReactRoot();
            if (!storeProps) return;
            this.reactRoot = this.createReactRoot(this.tldrawContainer, storeProps);
        }
    }

    return _TldrawLoadableMixin;
}
