const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Made by scripts/setup-mac-signing.sh; its password only guards this local, self-signed certificate.
const LOCAL_SIGNING = {
    name: 'Personalized Notetaker Local Signing',
    keychain: path.join(os.homedir(), 'Library/Keychains/notetaker-signing.keychain-db'),
    password: 'notetaker-local-signing',
};

function localSigningIdentity() {
    if (!fs.existsSync(LOCAL_SIGNING.keychain)) return null;
    try {
        execFileSync('security', ['unlock-keychain', '-p', LOCAL_SIGNING.password, LOCAL_SIGNING.keychain]);
        execFileSync('security', ['find-certificate', '-c', LOCAL_SIGNING.name, LOCAL_SIGNING.keychain], { stdio: 'ignore' });
        return LOCAL_SIGNING;
    } catch {
        return null;
    }
}

module.exports = {
    packagerConfig: {
        asar: {
            unpack: '**/{onnxruntime-node,onnxruntime-common,@huggingface/transformers,sharp,@img,uiohook-napi}/**',
        },
        extraResource: ['./src/assets/NotetakerAudio'],
        name: 'Personalized Notetaker',
        appBundleId: 'com.personalized.notetaker',
        icon: 'src/assets/notetaker',
        // Signed in the postPackage hook below. osxSign with identity '-' looks for a
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
        // macOS keeps Accessibility and Screen Recording for a signature requirement. With the local certificate
        // from scripts/setup-mac-signing.sh that requirement is "this bundle id, this certificate", the same on
        // every rebuild, so permissions survive. Without it the app is signed ad-hoc, whose requirement is the
        // code hash, so every rebuild needs `tccutil reset All com.personalized.notetaker` and new grants.
        // Hardened runtime stays off: it needs an Apple Developer ID or the app will not launch.
        postPackage: async (forgeConfig, { platform, outputPaths }) => {
            if (platform !== 'darwin') return;
            const identity = localSigningIdentity();
            if (!identity)
                console.warn('No local signing certificate; signing ad-hoc. Run scripts/setup-mac-signing.sh to keep permissions across rebuilds.');
            for (const dir of outputPaths) {
                const appPath = path.join(dir, `${forgeConfig.packagerConfig.name}.app`);
                const sign = identity ? ['--sign', identity.name, '--keychain', identity.keychain] : ['--sign', '-'];
                execFileSync('codesign', ['--force', '--deep', ...sign, '--entitlements', 'entitlements.plist', appPath], { stdio: 'inherit' });
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
