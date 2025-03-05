import React, { useCallback } from "react";
import Setting from "./Setting";
import useSettingsManager from "src/hooks/useSettingsManager";
import useUserPluginSettings from "src/hooks/useUserPluginSettings";

function EmbedsSettingsGroup() {
    const settingsManager = useSettingsManager();
    const settings = useUserPluginSettings(settingsManager);

    const onPaddingChange = useCallback(async (value: string) => {
        const padding = parseInt(value);
        if (isNaN(padding) || padding < 0) {
            return;
        }
        settingsManager.settings.embeds.padding = padding;
        await settingsManager.updateSettings(settingsManager.settings);
    }, [settingsManager]);

    const onShowBgChange = useCallback(async (value: boolean) => {
        settingsManager.settings.embeds.showBg = value;
        await settingsManager.updateSettings(settingsManager.settings);
    }, [settingsManager]);

    const onShowBgDotsChange = useCallback(async (value: boolean) => {
        settingsManager.settings.embeds.showBgDots = value;
        await settingsManager.updateSettings(settingsManager.settings);
    }, [settingsManager]);

    return (
        <>
            <Setting
                slots={{
                    name: 'Padding',
                    desc: 'The amount of padding to use by default for each embed image preview. This must be a non-negative number.',
                    control: (
                        <>
                            <Setting.Text
                                value={`${settings.embeds.padding}`}
                                onChange={onPaddingChange}
                            />
                        </>
                    )
                }}
            />
            <Setting
                slots={{
                    name: 'Show background',
                    desc: 'Whether to show the background for a markdown embed by default',
                    control: (
                        <>
                            <Setting.Toggle
                                value={settings.embeds.showBg}
                                onChange={onShowBgChange}
                            />
                        </>
                    )
                }}
            />
            <Setting
                slots={{
                    name: 'Show background dotted pattern',
                    desc: 'Whether to show the background dotted pattern for a markdown embed by default',
                    control: (
                        <>
                            <Setting.Toggle
                                value={settings.embeds.showBgDots}
                                onChange={onShowBgDotsChange}
                            />
                        </>
                    )
                }}
            />
        </>
    );
}

export default function EmbedsSettings() {
    return (
        <>
            <Setting.Container>
                <EmbedsSettingsGroup />
            </Setting.Container>
        </>
    );
}