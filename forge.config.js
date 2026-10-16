const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/{onnxruntime-node,onnxruntime-common,@huggingface/transformers,sharp,@img,uiohook-napi}/**',
        },
        extraResource: ['./src/assets/NotetakerAudio'],
        name: 'Personalized Notetaker',
        appBundleId: 'com.personalized.notetaker',
        icon: 'src/assets/notetaker',
        // Signed ad-hoc in the postPackage hook below. osxSign with identity '-' looks for a
        // keychain identity named "-", fails, and silently leaves Electron's own signature.
        // notarize if off cuz i ran this for 6 hours and it still didnt finish
        // osxNotarize: {
        //    appleId: 'your apple id',
        //    appleIdPassword: 'app specific password',
        //    teamId: 'your team id',
        // },
    },
    rebuildConfig: {},
    hooks: {
        // Ad-hoc signature under com.personalized.notetaker, so macOS permissions belong to this app.
        // Hardened runtime stays off: it needs an Apple Developer ID or the app will not launch.
        // Every rebuild changes the signature, so run `tccutil reset All com.personalized.notetaker` and grant again.
        postPackage: async (forgeConfig, { platform, outputPaths }) => {
            if (platform !== 'darwin') return;
            for (const dir of outputPaths) {
                const appPath = path.join(dir, `${forgeConfig.packagerConfig.name}.app`);
                execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', 'entitlements.plist', appPath], { stdio: 'inherit' });
            }
        },
    },
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'cheating-daddy',
                productName: 'Cheating Daddy',
                shortcutName: 'Cheating Daddy',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
        },
        {
            name: '@reforged/maker-appimage',
            platforms: ['linux'],
            config: {
                options: {
                    name: 'Cheating Daddy',
                    productName: 'Cheating Daddy',
                    genericName: 'AI Assistant',
                    description: 'AI assistant for interviews and learning',
                    categories: ['Development', 'Education'],
                    icon: 'src/assets/logo.png',
                },
            },
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
