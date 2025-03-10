import { App, Modal, Setting } from "obsidian";

export class ResolutionSelectionModal extends Modal {
  private resolution: number = 1.5;
  private resolvePromise: (value: number | null) => void = () => {};

  constructor(app: App) {
    super(app);
  }

  async openAndGetResolution(): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    
    contentEl.createEl("h2", { text: "PDF Import Resolution" });
    contentEl.createEl("p", { 
      text: "Higher resolution will produce clearer images but may be slower and consume more memory." 
    });

    new Setting(contentEl)
      .setName("Resolution")
      .setDesc("Select the PDF import resolution")
      .addSlider(slider => slider
        .setLimits(0.5, 10, 0.1)
        .setValue(1.5)
        .setDynamicTooltip()
        .onChange(value => {
          this.resolution = value;
        })
      );
      
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText("Import PDF")
        .setCta()
        .onClick(() => {
          this.close();
          this.resolvePromise(this.resolution);
        }))
      .addButton(btn => btn
        .setButtonText("Cancel")
        .onClick(() => {
          this.close();
          this.resolvePromise(null);
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}