#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `),
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["browser-sync", new Map([
    ["2.26.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-browser-sync-2.26.3-1b59bd5935938a5b0fa73b3d78ef1050bd2bf912/node_modules/browser-sync/"),
      packageDependencies: new Map([
        ["browser-sync-client", "2.26.2"],
        ["browser-sync-ui", "2.26.2"],
        ["bs-recipes", "1.3.4"],
        ["bs-snippet-injector", "2.0.1"],
        ["chokidar", "2.0.4"],
        ["connect", "3.6.6"],
        ["connect-history-api-fallback", "1.6.0"],
        ["dev-ip", "1.0.1"],
        ["easy-extender", "2.3.4"],
        ["eazy-logger", "3.0.2"],
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["fs-extra", "3.0.1"],
        ["http-proxy", "1.15.2"],
        ["immutable", "3.8.2"],
        ["localtunnel", "1.9.1"],
        ["micromatch", "2.3.11"],
        ["opn", "5.3.0"],
        ["portscanner", "2.1.1"],
        ["qs", "6.2.3"],
        ["raw-body", "2.3.3"],
        ["resp-modifier", "6.0.2"],
        ["rx", "4.1.0"],
        ["send", "0.16.2"],
        ["serve-index", "1.9.1"],
        ["serve-static", "1.13.2"],
        ["server-destroy", "1.0.1"],
        ["socket.io", "2.1.1"],
        ["ua-parser-js", "0.7.17"],
        ["yargs", "6.4.0"],
        ["browser-sync", "2.26.3"],
      ]),
    }],
  ])],
  ["browser-sync-client", new Map([
    ["2.26.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-browser-sync-client-2.26.2-dd0070c80bdc6d9021e89f7837ee70ed0a8acf91/node_modules/browser-sync-client/"),
      packageDependencies: new Map([
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["mitt", "1.1.3"],
        ["rxjs", "5.5.12"],
        ["browser-sync-client", "2.26.2"],
      ]),
    }],
  ])],
  ["etag", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887/node_modules/etag/"),
      packageDependencies: new Map([
        ["etag", "1.8.1"],
      ]),
    }],
  ])],
  ["fresh", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/"),
      packageDependencies: new Map([
        ["fresh", "0.5.2"],
      ]),
    }],
  ])],
  ["mitt", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mitt-1.1.3-528c506238a05dce11cd914a741ea2cc332da9b8/node_modules/mitt/"),
      packageDependencies: new Map([
        ["mitt", "1.1.3"],
      ]),
    }],
  ])],
  ["rxjs", new Map([
    ["5.5.12", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-rxjs-5.5.12-6fa61b8a77c3d793dbaf270bee2f43f652d741cc/node_modules/rxjs/"),
      packageDependencies: new Map([
        ["symbol-observable", "1.0.1"],
        ["rxjs", "5.5.12"],
      ]),
    }],
  ])],
  ["symbol-observable", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-symbol-observable-1.0.1-8340fc4702c3122df5d22288f88283f513d3fdd4/node_modules/symbol-observable/"),
      packageDependencies: new Map([
        ["symbol-observable", "1.0.1"],
      ]),
    }],
  ])],
  ["browser-sync-ui", new Map([
    ["2.26.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-browser-sync-ui-2.26.2-a1d8e107cfed5849d77e3bbd84ae5d566beb4ea0/node_modules/browser-sync-ui/"),
      packageDependencies: new Map([
        ["async-each-series", "0.1.1"],
        ["connect-history-api-fallback", "1.6.0"],
        ["immutable", "3.8.2"],
        ["server-destroy", "1.0.1"],
        ["socket.io-client", "2.2.0"],
        ["stream-throttle", "0.1.3"],
        ["browser-sync-ui", "2.26.2"],
      ]),
    }],
  ])],
  ["async-each-series", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-async-each-series-0.1.1-7617c1917401fd8ca4a28aadce3dbae98afeb432/node_modules/async-each-series/"),
      packageDependencies: new Map([
        ["async-each-series", "0.1.1"],
      ]),
    }],
  ])],
  ["connect-history-api-fallback", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-connect-history-api-fallback-1.6.0-8b32089359308d111115d81cad3fceab888f97bc/node_modules/connect-history-api-fallback/"),
      packageDependencies: new Map([
        ["connect-history-api-fallback", "1.6.0"],
      ]),
    }],
  ])],
  ["immutable", new Map([
    ["3.8.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-immutable-3.8.2-c2439951455bb39913daf281376f1530e104adf3/node_modules/immutable/"),
      packageDependencies: new Map([
        ["immutable", "3.8.2"],
      ]),
    }],
  ])],
  ["server-destroy", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-server-destroy-1.0.1-f13bf928e42b9c3e79383e61cc3998b5d14e6cdd/node_modules/server-destroy/"),
      packageDependencies: new Map([
        ["server-destroy", "1.0.1"],
      ]),
    }],
  ])],
  ["socket.io-client", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-client-2.2.0-84e73ee3c43d5020ccc1a258faeeb9aec2723af7/node_modules/socket.io-client/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
        ["base64-arraybuffer", "0.1.5"],
        ["component-bind", "1.0.0"],
        ["component-emitter", "1.2.1"],
        ["debug", "3.1.0"],
        ["engine.io-client", "3.3.2"],
        ["has-binary2", "1.0.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["object-component", "0.0.3"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["socket.io-parser", "3.3.0"],
        ["to-array", "0.1.4"],
        ["socket.io-client", "2.2.0"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-client-2.1.1-dcb38103436ab4578ddb026638ae2f21b623671f/node_modules/socket.io-client/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
        ["base64-arraybuffer", "0.1.5"],
        ["component-bind", "1.0.0"],
        ["component-emitter", "1.2.1"],
        ["debug", "3.1.0"],
        ["engine.io-client", "3.2.1"],
        ["has-binary2", "1.0.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["object-component", "0.0.3"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["socket.io-parser", "3.2.0"],
        ["to-array", "0.1.4"],
        ["socket.io-client", "2.1.1"],
      ]),
    }],
  ])],
  ["backo2", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-backo2-1.0.2-31ab1ac8b129363463e35b3ebb69f4dfcfba7947/node_modules/backo2/"),
      packageDependencies: new Map([
        ["backo2", "1.0.2"],
      ]),
    }],
  ])],
  ["base64-arraybuffer", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-base64-arraybuffer-0.1.5-73926771923b5a19747ad666aa5cd4bf9c6e9ce8/node_modules/base64-arraybuffer/"),
      packageDependencies: new Map([
        ["base64-arraybuffer", "0.1.5"],
      ]),
    }],
  ])],
  ["component-bind", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-component-bind-1.0.0-00c608ab7dcd93897c0009651b1d3a8e1e73bbd1/node_modules/component-bind/"),
      packageDependencies: new Map([
        ["component-bind", "1.0.0"],
      ]),
    }],
  ])],
  ["component-emitter", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-component-emitter-1.2.1-137918d6d78283f7df7a6b7c5a63e140e69425e6/node_modules/component-emitter/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "3.1.0"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.1"],
        ["debug", "4.1.1"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ms-2.1.1-30a5864eb3ebb0a66f2ebe6d727af06a09d86e0a/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.1"],
      ]),
    }],
  ])],
  ["engine.io-client", new Map([
    ["3.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-engine-io-client-3.3.2-04e068798d75beda14375a264bb3d742d7bc33aa/node_modules/engine.io-client/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
        ["component-inherit", "0.0.3"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["ws", "6.1.3"],
        ["xmlhttprequest-ssl", "1.5.5"],
        ["yeast", "0.1.2"],
        ["engine.io-client", "3.3.2"],
      ]),
    }],
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-engine-io-client-3.2.1-6f54c0475de487158a1a7c77d10178708b6add36/node_modules/engine.io-client/"),
      packageDependencies: new Map([
        ["component-emitter", "1.2.1"],
        ["component-inherit", "0.0.3"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["has-cors", "1.1.0"],
        ["indexof", "0.0.1"],
        ["parseqs", "0.0.5"],
        ["parseuri", "0.0.5"],
        ["ws", "3.3.3"],
        ["xmlhttprequest-ssl", "1.5.5"],
        ["yeast", "0.1.2"],
        ["engine.io-client", "3.2.1"],
      ]),
    }],
  ])],
  ["component-inherit", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-component-inherit-0.0.3-645fc4adf58b72b649d5cae65135619db26ff143/node_modules/component-inherit/"),
      packageDependencies: new Map([
        ["component-inherit", "0.0.3"],
      ]),
    }],
  ])],
  ["engine.io-parser", new Map([
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-engine-io-parser-2.1.3-757ab970fbf2dfb32c7b74b033216d5739ef79a6/node_modules/engine.io-parser/"),
      packageDependencies: new Map([
        ["after", "0.8.2"],
        ["arraybuffer.slice", "0.0.7"],
        ["base64-arraybuffer", "0.1.5"],
        ["blob", "0.0.5"],
        ["has-binary2", "1.0.3"],
        ["engine.io-parser", "2.1.3"],
      ]),
    }],
  ])],
  ["after", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-after-0.8.2-fedb394f9f0e02aa9768e702bda23b505fae7e1f/node_modules/after/"),
      packageDependencies: new Map([
        ["after", "0.8.2"],
      ]),
    }],
  ])],
  ["arraybuffer.slice", new Map([
    ["0.0.7", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arraybuffer-slice-0.0.7-3bbc4275dd584cc1b10809b89d4e8b63a69e7675/node_modules/arraybuffer.slice/"),
      packageDependencies: new Map([
        ["arraybuffer.slice", "0.0.7"],
      ]),
    }],
  ])],
  ["blob", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-blob-0.0.5-d680eeef25f8cd91ad533f5b01eed48e64caf683/node_modules/blob/"),
      packageDependencies: new Map([
        ["blob", "0.0.5"],
      ]),
    }],
  ])],
  ["has-binary2", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-binary2-1.0.3-7776ac627f3ea77250cfc332dab7ddf5e4f5d11d/node_modules/has-binary2/"),
      packageDependencies: new Map([
        ["isarray", "2.0.1"],
        ["has-binary2", "1.0.3"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-isarray-2.0.1-a37d94ed9cda2d59865c9f76fe596ee1f338741e/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "2.0.1"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["has-cors", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-cors-1.1.0-5e474793f7ea9843d1bb99c23eef49ff126fff39/node_modules/has-cors/"),
      packageDependencies: new Map([
        ["has-cors", "1.1.0"],
      ]),
    }],
  ])],
  ["indexof", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/"),
      packageDependencies: new Map([
        ["indexof", "0.0.1"],
      ]),
    }],
  ])],
  ["parseqs", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parseqs-0.0.5-d5208a3738e46766e291ba2ea173684921a8b89d/node_modules/parseqs/"),
      packageDependencies: new Map([
        ["better-assert", "1.0.2"],
        ["parseqs", "0.0.5"],
      ]),
    }],
  ])],
  ["better-assert", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-better-assert-1.0.2-40866b9e1b9e0b55b481894311e68faffaebc522/node_modules/better-assert/"),
      packageDependencies: new Map([
        ["callsite", "1.0.0"],
        ["better-assert", "1.0.2"],
      ]),
    }],
  ])],
  ["callsite", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-callsite-1.0.0-280398e5d664bd74038b6f0905153e6e8af1bc20/node_modules/callsite/"),
      packageDependencies: new Map([
        ["callsite", "1.0.0"],
      ]),
    }],
  ])],
  ["parseuri", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parseuri-0.0.5-80204a50d4dbb779bfdc6ebe2778d90e4bce320a/node_modules/parseuri/"),
      packageDependencies: new Map([
        ["better-assert", "1.0.2"],
        ["parseuri", "0.0.5"],
      ]),
    }],
  ])],
  ["ws", new Map([
    ["6.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ws-6.1.3-d2d2e5f0e3c700ef2de89080ebc0ac6e1bf3a72d/node_modules/ws/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.0"],
        ["ws", "6.1.3"],
      ]),
    }],
    ["3.3.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ws-3.3.3-f1cf84fe2d5e901ebce94efaece785f187a228f2/node_modules/ws/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.0"],
        ["safe-buffer", "5.1.2"],
        ["ultron", "1.1.1"],
        ["ws", "3.3.3"],
      ]),
    }],
  ])],
  ["async-limiter", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-async-limiter-1.0.0-78faed8c3d074ab81f22b4e985d79e8738f720f8/node_modules/async-limiter/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.0"],
      ]),
    }],
  ])],
  ["xmlhttprequest-ssl", new Map([
    ["1.5.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-xmlhttprequest-ssl-1.5.5-c2876b06168aadc40e57d97e81191ac8f4398b3e/node_modules/xmlhttprequest-ssl/"),
      packageDependencies: new Map([
        ["xmlhttprequest-ssl", "1.5.5"],
      ]),
    }],
  ])],
  ["yeast", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yeast-0.1.2-008e06d8094320c372dbc2f8ed76a0ca6c8ac419/node_modules/yeast/"),
      packageDependencies: new Map([
        ["yeast", "0.1.2"],
      ]),
    }],
  ])],
  ["object-component", new Map([
    ["0.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-component-0.0.3-f0c69aa50efc95b866c186f400a33769cb2f1291/node_modules/object-component/"),
      packageDependencies: new Map([
        ["object-component", "0.0.3"],
      ]),
    }],
  ])],
  ["socket.io-parser", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-parser-3.3.0-2b52a96a509fdf31440ba40fed6094c7d4f1262f/node_modules/socket.io-parser/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["component-emitter", "1.2.1"],
        ["isarray", "2.0.1"],
        ["socket.io-parser", "3.3.0"],
      ]),
    }],
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-parser-3.2.0-e7c6228b6aa1f814e6148aea325b51aa9499e077/node_modules/socket.io-parser/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["component-emitter", "1.2.1"],
        ["isarray", "2.0.1"],
        ["socket.io-parser", "3.2.0"],
      ]),
    }],
  ])],
  ["to-array", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-to-array-0.1.4-17e6c11f73dd4f3d74cda7a4ff3238e9ad9bf890/node_modules/to-array/"),
      packageDependencies: new Map([
        ["to-array", "0.1.4"],
      ]),
    }],
  ])],
  ["stream-throttle", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-stream-throttle-0.1.3-add57c8d7cc73a81630d31cd55d3961cfafba9c3/node_modules/stream-throttle/"),
      packageDependencies: new Map([
        ["commander", "2.19.0"],
        ["limiter", "1.1.4"],
        ["stream-throttle", "0.1.3"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.19.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-commander-2.19.0-f6198aa84e5b83c46054b94ddedbfed5ee9ff12a/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.19.0"],
      ]),
    }],
  ])],
  ["limiter", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-limiter-1.1.4-87c9c3972d389fdb0ba67a45aadbc5d2f8413bc1/node_modules/limiter/"),
      packageDependencies: new Map([
        ["limiter", "1.1.4"],
      ]),
    }],
  ])],
  ["bs-recipes", new Map([
    ["1.3.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-bs-recipes-1.3.4-0d2d4d48a718c8c044769fdc4f89592dc8b69585/node_modules/bs-recipes/"),
      packageDependencies: new Map([
        ["bs-recipes", "1.3.4"],
      ]),
    }],
  ])],
  ["bs-snippet-injector", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-bs-snippet-injector-2.0.1-61b5393f11f52559ed120693100343b6edb04dd5/node_modules/bs-snippet-injector/"),
      packageDependencies: new Map([
        ["bs-snippet-injector", "2.0.1"],
      ]),
    }],
  ])],
  ["chokidar", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-chokidar-2.0.4-356ff4e2b0e8e43e322d18a372460bbcf3accd26/node_modules/chokidar/"),
      packageDependencies: new Map([
        ["anymatch", "2.0.0"],
        ["async-each", "1.0.1"],
        ["braces", "2.3.2"],
        ["glob-parent", "3.1.0"],
        ["inherits", "2.0.3"],
        ["is-binary-path", "1.0.1"],
        ["is-glob", "4.0.0"],
        ["lodash.debounce", "4.0.8"],
        ["normalize-path", "2.1.1"],
        ["path-is-absolute", "1.0.1"],
        ["readdirp", "2.2.1"],
        ["upath", "1.1.0"],
        ["fsevents", "1.2.7"],
        ["chokidar", "2.0.4"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["micromatch", "3.1.10"],
        ["normalize-path", "2.1.1"],
        ["anymatch", "2.0.0"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["3.1.10", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["braces", "2.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["extglob", "2.0.4"],
        ["fragment-cache", "0.2.1"],
        ["kind-of", "6.0.2"],
        ["nanomatch", "1.2.13"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["micromatch", "3.1.10"],
      ]),
    }],
    ["2.3.11", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-micromatch-2.3.11-86677c97d1720b363431d04d0d15293bd38c1565/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["arr-diff", "2.0.0"],
        ["array-unique", "0.2.1"],
        ["braces", "1.8.5"],
        ["expand-brackets", "0.1.5"],
        ["extglob", "0.3.2"],
        ["filename-regex", "2.0.1"],
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
        ["kind-of", "3.2.2"],
        ["normalize-path", "2.1.1"],
        ["object.omit", "2.0.1"],
        ["parse-glob", "3.0.4"],
        ["regex-cache", "0.4.4"],
        ["micromatch", "2.3.11"],
      ]),
    }],
  ])],
  ["arr-diff", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arr-diff-2.0.0-8f3b827f955a8bd669697e4a4256ac3ceae356cf/node_modules/arr-diff/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["arr-diff", "2.0.0"],
      ]),
    }],
  ])],
  ["array-unique", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
      ]),
    }],
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-array-unique-0.2.1-a1d97ccafcbc2625cc70fadceb36a50c58b01a53/node_modules/array-unique/"),
      packageDependencies: new Map([
        ["array-unique", "0.2.1"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["2.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
        ["array-unique", "0.3.2"],
        ["extend-shallow", "2.0.1"],
        ["fill-range", "4.0.0"],
        ["isobject", "3.0.1"],
        ["repeat-element", "1.1.3"],
        ["snapdragon", "0.8.2"],
        ["snapdragon-node", "2.1.1"],
        ["split-string", "3.1.0"],
        ["to-regex", "3.0.2"],
        ["braces", "2.3.2"],
      ]),
    }],
    ["1.8.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-braces-1.8.5-ba77962e12dff969d6b76711e914b737857bf6a7/node_modules/braces/"),
      packageDependencies: new Map([
        ["expand-range", "1.8.2"],
        ["preserve", "0.2.0"],
        ["repeat-element", "1.1.3"],
        ["braces", "1.8.5"],
      ]),
    }],
  ])],
  ["arr-flatten", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/"),
      packageDependencies: new Map([
        ["arr-flatten", "1.1.0"],
      ]),
    }],
  ])],
  ["extend-shallow", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
        ["extend-shallow", "2.0.1"],
      ]),
    }],
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
        ["is-extendable", "1.0.1"],
        ["extend-shallow", "3.0.2"],
      ]),
    }],
  ])],
  ["is-extendable", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-extendable", "0.1.1"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["is-extendable", "1.0.1"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
        ["fill-range", "4.0.0"],
      ]),
    }],
    ["2.2.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fill-range-2.2.4-eb1e773abb056dcd8df2bfdf6af59b8b3a936565/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["is-number", "2.1.0"],
        ["isobject", "2.1.0"],
        ["randomatic", "3.1.1"],
        ["repeat-element", "1.1.3"],
        ["repeat-string", "1.6.1"],
        ["fill-range", "2.2.4"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "3.0.0"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-number-2.1.0-01fcbbb393463a548f2f466cce16dece49db908f/node_modules/is-number/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-number", "2.1.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-number-4.0.0-0026e37f5454d73e356dfe6564699867c6a7f0ff/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "4.0.0"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "3.2.2"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
        ["kind-of", "4.0.0"],
      ]),
    }],
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "5.1.0"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["1.1.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "1.1.6"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.3"],
      ]),
    }],
  ])],
  ["repeat-string", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/"),
      packageDependencies: new Map([
        ["repeat-string", "1.6.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["repeat-string", "1.6.1"],
        ["to-regex-range", "2.1.1"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
        ["isobject", "2.1.0"],
      ]),
    }],
  ])],
  ["repeat-element", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/"),
      packageDependencies: new Map([
        ["repeat-element", "1.1.3"],
      ]),
    }],
  ])],
  ["snapdragon", new Map([
    ["0.8.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/"),
      packageDependencies: new Map([
        ["base", "0.11.2"],
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["map-cache", "0.2.2"],
        ["source-map", "0.5.7"],
        ["source-map-resolve", "0.5.2"],
        ["use", "3.1.1"],
        ["snapdragon", "0.8.2"],
      ]),
    }],
  ])],
  ["base", new Map([
    ["0.11.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/"),
      packageDependencies: new Map([
        ["cache-base", "1.0.1"],
        ["class-utils", "0.3.6"],
        ["component-emitter", "1.2.1"],
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["mixin-deep", "1.3.1"],
        ["pascalcase", "0.1.1"],
        ["base", "0.11.2"],
      ]),
    }],
  ])],
  ["cache-base", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/"),
      packageDependencies: new Map([
        ["collection-visit", "1.0.0"],
        ["component-emitter", "1.2.1"],
        ["get-value", "2.0.6"],
        ["has-value", "1.0.0"],
        ["isobject", "3.0.1"],
        ["set-value", "2.0.0"],
        ["to-object-path", "0.3.0"],
        ["union-value", "1.0.0"],
        ["unset-value", "1.0.0"],
        ["cache-base", "1.0.1"],
      ]),
    }],
  ])],
  ["collection-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/"),
      packageDependencies: new Map([
        ["map-visit", "1.0.0"],
        ["object-visit", "1.0.1"],
        ["collection-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["map-visit", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/"),
      packageDependencies: new Map([
        ["object-visit", "1.0.1"],
        ["map-visit", "1.0.0"],
      ]),
    }],
  ])],
  ["object-visit", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object-visit", "1.0.1"],
      ]),
    }],
  ])],
  ["get-value", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
      ]),
    }],
  ])],
  ["has-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "1.0.0"],
        ["isobject", "3.0.1"],
        ["has-value", "1.0.0"],
      ]),
    }],
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/"),
      packageDependencies: new Map([
        ["get-value", "2.0.6"],
        ["has-values", "0.1.4"],
        ["isobject", "2.1.0"],
        ["has-value", "0.3.1"],
      ]),
    }],
  ])],
  ["has-values", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/"),
      packageDependencies: new Map([
        ["is-number", "3.0.0"],
        ["kind-of", "4.0.0"],
        ["has-values", "1.0.0"],
      ]),
    }],
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/"),
      packageDependencies: new Map([
        ["has-values", "0.1.4"],
      ]),
    }],
  ])],
  ["set-value", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-set-value-2.0.0-71ae4a88f0feefbbf52d1ea604f3fb315ebb6274/node_modules/set-value/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-extendable", "0.1.1"],
        ["is-plain-object", "2.0.4"],
        ["split-string", "3.1.0"],
        ["set-value", "2.0.0"],
      ]),
    }],
    ["0.4.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-set-value-0.4.3-7db08f9d3d22dc7f78e53af3c3bf4666ecdfccf1/node_modules/set-value/"),
      packageDependencies: new Map([
        ["extend-shallow", "2.0.1"],
        ["is-extendable", "0.1.1"],
        ["is-plain-object", "2.0.4"],
        ["to-object-path", "0.3.0"],
        ["set-value", "0.4.3"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["split-string", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["split-string", "3.1.0"],
      ]),
    }],
  ])],
  ["assign-symbols", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/"),
      packageDependencies: new Map([
        ["assign-symbols", "1.0.0"],
      ]),
    }],
  ])],
  ["to-object-path", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["to-object-path", "0.3.0"],
      ]),
    }],
  ])],
  ["union-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-union-value-1.0.0-5c71c34cb5bad5dcebe3ea0cd08207ba5aa1aea4/node_modules/union-value/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["get-value", "2.0.6"],
        ["is-extendable", "0.1.1"],
        ["set-value", "0.4.3"],
        ["union-value", "1.0.0"],
      ]),
    }],
  ])],
  ["arr-union", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
      ]),
    }],
  ])],
  ["unset-value", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/"),
      packageDependencies: new Map([
        ["has-value", "0.3.1"],
        ["isobject", "3.0.1"],
        ["unset-value", "1.0.0"],
      ]),
    }],
  ])],
  ["class-utils", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/"),
      packageDependencies: new Map([
        ["arr-union", "3.1.0"],
        ["define-property", "0.2.5"],
        ["isobject", "3.0.1"],
        ["static-extend", "0.1.2"],
        ["class-utils", "0.3.6"],
      ]),
    }],
  ])],
  ["define-property", new Map([
    ["0.2.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "0.1.6"],
        ["define-property", "0.2.5"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["define-property", "1.0.0"],
      ]),
    }],
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/"),
      packageDependencies: new Map([
        ["is-descriptor", "1.0.2"],
        ["isobject", "3.0.1"],
        ["define-property", "2.0.2"],
      ]),
    }],
  ])],
  ["is-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "0.1.6"],
        ["is-data-descriptor", "0.1.4"],
        ["kind-of", "5.1.0"],
        ["is-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/"),
      packageDependencies: new Map([
        ["is-accessor-descriptor", "1.0.0"],
        ["is-data-descriptor", "1.0.0"],
        ["kind-of", "6.0.2"],
        ["is-descriptor", "1.0.2"],
      ]),
    }],
  ])],
  ["is-accessor-descriptor", new Map([
    ["0.1.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-accessor-descriptor", "0.1.6"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-accessor-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["is-data-descriptor", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["is-data-descriptor", "0.1.4"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.2"],
        ["is-data-descriptor", "1.0.0"],
      ]),
    }],
  ])],
  ["static-extend", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/"),
      packageDependencies: new Map([
        ["define-property", "0.2.5"],
        ["object-copy", "0.1.0"],
        ["static-extend", "0.1.2"],
      ]),
    }],
  ])],
  ["object-copy", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
        ["define-property", "0.2.5"],
        ["kind-of", "3.2.2"],
        ["object-copy", "0.1.0"],
      ]),
    }],
  ])],
  ["copy-descriptor", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/"),
      packageDependencies: new Map([
        ["copy-descriptor", "0.1.1"],
      ]),
    }],
  ])],
  ["mixin-deep", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mixin-deep-1.3.1-a49e7268dce1a0d9698e45326c5626df3543d0fe/node_modules/mixin-deep/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["is-extendable", "1.0.1"],
        ["mixin-deep", "1.3.1"],
      ]),
    }],
  ])],
  ["for-in", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
      ]),
    }],
  ])],
  ["pascalcase", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/"),
      packageDependencies: new Map([
        ["pascalcase", "0.1.1"],
      ]),
    }],
  ])],
  ["map-cache", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.5.7"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
  ])],
  ["source-map-resolve", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
        ["decode-uri-component", "0.2.0"],
        ["resolve-url", "0.2.1"],
        ["source-map-url", "0.4.0"],
        ["urix", "0.1.0"],
        ["source-map-resolve", "0.5.2"],
      ]),
    }],
  ])],
  ["atob", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/"),
      packageDependencies: new Map([
        ["atob", "2.1.2"],
      ]),
    }],
  ])],
  ["decode-uri-component", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/"),
      packageDependencies: new Map([
        ["decode-uri-component", "0.2.0"],
      ]),
    }],
  ])],
  ["resolve-url", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/"),
      packageDependencies: new Map([
        ["resolve-url", "0.2.1"],
      ]),
    }],
  ])],
  ["source-map-url", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/"),
      packageDependencies: new Map([
        ["source-map-url", "0.4.0"],
      ]),
    }],
  ])],
  ["urix", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/"),
      packageDependencies: new Map([
        ["urix", "0.1.0"],
      ]),
    }],
  ])],
  ["use", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/"),
      packageDependencies: new Map([
        ["use", "3.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-node", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/"),
      packageDependencies: new Map([
        ["define-property", "1.0.0"],
        ["isobject", "3.0.1"],
        ["snapdragon-util", "3.0.1"],
        ["snapdragon-node", "2.1.1"],
      ]),
    }],
  ])],
  ["snapdragon-util", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/"),
      packageDependencies: new Map([
        ["kind-of", "3.2.2"],
        ["snapdragon-util", "3.0.1"],
      ]),
    }],
  ])],
  ["to-regex", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/"),
      packageDependencies: new Map([
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["regex-not", "1.0.2"],
        ["safe-regex", "1.1.0"],
        ["to-regex", "3.0.2"],
      ]),
    }],
  ])],
  ["regex-not", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/"),
      packageDependencies: new Map([
        ["extend-shallow", "3.0.2"],
        ["safe-regex", "1.1.0"],
        ["regex-not", "1.0.2"],
      ]),
    }],
  ])],
  ["safe-regex", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
        ["safe-regex", "1.1.0"],
      ]),
    }],
  ])],
  ["ret", new Map([
    ["0.1.15", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/"),
      packageDependencies: new Map([
        ["ret", "0.1.15"],
      ]),
    }],
  ])],
  ["extglob", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/"),
      packageDependencies: new Map([
        ["array-unique", "0.3.2"],
        ["define-property", "1.0.0"],
        ["expand-brackets", "2.1.4"],
        ["extend-shallow", "2.0.1"],
        ["fragment-cache", "0.2.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["extglob", "2.0.4"],
      ]),
    }],
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-extglob-0.3.2-2e18ff3d2f49ab2765cec9023f011daa8d8349a1/node_modules/extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
        ["extglob", "0.3.2"],
      ]),
    }],
  ])],
  ["expand-brackets", new Map([
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["define-property", "0.2.5"],
        ["extend-shallow", "2.0.1"],
        ["posix-character-classes", "0.1.1"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["expand-brackets", "2.1.4"],
      ]),
    }],
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-expand-brackets-0.1.5-df07284e342a807cd733ac5af72411e581d1177b/node_modules/expand-brackets/"),
      packageDependencies: new Map([
        ["is-posix-bracket", "0.1.1"],
        ["expand-brackets", "0.1.5"],
      ]),
    }],
  ])],
  ["posix-character-classes", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/"),
      packageDependencies: new Map([
        ["posix-character-classes", "0.1.1"],
      ]),
    }],
  ])],
  ["fragment-cache", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/"),
      packageDependencies: new Map([
        ["map-cache", "0.2.2"],
        ["fragment-cache", "0.2.1"],
      ]),
    }],
  ])],
  ["nanomatch", new Map([
    ["1.2.13", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/"),
      packageDependencies: new Map([
        ["arr-diff", "4.0.0"],
        ["array-unique", "0.3.2"],
        ["define-property", "2.0.2"],
        ["extend-shallow", "3.0.2"],
        ["fragment-cache", "0.2.1"],
        ["is-windows", "1.0.2"],
        ["kind-of", "6.0.2"],
        ["object.pick", "1.3.0"],
        ["regex-not", "1.0.2"],
        ["snapdragon", "0.8.2"],
        ["to-regex", "3.0.2"],
        ["nanomatch", "1.2.13"],
      ]),
    }],
  ])],
  ["is-windows", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/"),
      packageDependencies: new Map([
        ["is-windows", "1.0.2"],
      ]),
    }],
  ])],
  ["object.pick", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["object.pick", "1.3.0"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
        ["normalize-path", "2.1.1"],
      ]),
    }],
  ])],
  ["remove-trailing-separator", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/"),
      packageDependencies: new Map([
        ["remove-trailing-separator", "1.1.0"],
      ]),
    }],
  ])],
  ["async-each", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-async-each-1.0.1-19d386a1d9edc6e7c1c85d388aedbcc56d33602d/node_modules/async-each/"),
      packageDependencies: new Map([
        ["async-each", "1.0.1"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "3.1.0"],
        ["path-dirname", "1.0.2"],
        ["glob-parent", "3.1.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-glob-parent-2.0.0-81383d72db054fcccf5336daa902f182f6edbb28/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "2.0.1"],
        ["glob-parent", "2.0.0"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "3.1.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-glob-4.0.0-9521c76845cc2610a85203ddf080a958c2ffabc0/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.0"],
      ]),
    }],
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-glob-2.0.1-d096f926a3ded5600f3fdfd91198cb0888c2d863/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-extglob-1.0.0-ac468177c4943405a092fc8f29760c6ffc6206c0/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "1.0.0"],
      ]),
    }],
  ])],
  ["path-dirname", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/"),
      packageDependencies: new Map([
        ["path-dirname", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
  ])],
  ["is-binary-path", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-binary-path-1.0.1-75f16642b480f187a711c814161fd3a4a7655898/node_modules/is-binary-path/"),
      packageDependencies: new Map([
        ["binary-extensions", "1.12.0"],
        ["is-binary-path", "1.0.1"],
      ]),
    }],
  ])],
  ["binary-extensions", new Map([
    ["1.12.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-binary-extensions-1.12.0-c2d780f53d45bba8317a8902d4ceeaf3a6385b14/node_modules/binary-extensions/"),
      packageDependencies: new Map([
        ["binary-extensions", "1.12.0"],
      ]),
    }],
  ])],
  ["lodash.debounce", new Map([
    ["4.0.8", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-lodash-debounce-4.0.8-82d79bff30a67c4005ffd5e2515300ad9ca4d7af/node_modules/lodash.debounce/"),
      packageDependencies: new Map([
        ["lodash.debounce", "4.0.8"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["readdirp", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-readdirp-2.2.1-0e87622a3325aa33e892285caf8b4e846529a525/node_modules/readdirp/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["micromatch", "3.1.10"],
        ["readable-stream", "2.3.6"],
        ["readdirp", "2.2.1"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.1.15", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-graceful-fs-4.1.15-ffb703e1066e8a0eeaa4c8b80ba9253eeefbfb00/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["2.3.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.3"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.0"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.6"],
      ]),
    }],
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-readable-stream-3.1.1-ed6bbc6c5ba58b090039ff18ce670515795aeb06/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
        ["string_decoder", "1.2.0"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "3.1.1"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.0-a37d732f4271b4ab1ad070d35508e8290788ffaa/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.0"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-string-decoder-1.2.0-fe86e738b19544afe70469243b2a1ee9240eae8d/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.2.0"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["upath", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-upath-1.1.0-35256597e46a581db4793d0ce47fa9aebfc9fabd/node_modules/upath/"),
      packageDependencies: new Map([
        ["upath", "1.1.0"],
      ]),
    }],
  ])],
  ["fsevents", new Map([
    ["1.2.7", {
      packageLocation: path.resolve(__dirname, "./.pnp/unplugged/npm-fsevents-1.2.7-4851b664a3783e52003b3c66eb0eee1074933aa4/node_modules/fsevents/"),
      packageDependencies: new Map([
        ["nan", "2.12.1"],
        ["node-pre-gyp", "0.10.3"],
        ["fsevents", "1.2.7"],
      ]),
    }],
  ])],
  ["nan", new Map([
    ["2.12.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-nan-2.12.1-7b1aa193e9aa86057e3c7bbd0ac448e770925552/node_modules/nan/"),
      packageDependencies: new Map([
        ["nan", "2.12.1"],
      ]),
    }],
  ])],
  ["node-pre-gyp", new Map([
    ["0.10.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-node-pre-gyp-0.10.3-3070040716afdc778747b61b6887bf78880b80fc/node_modules/node-pre-gyp/"),
      packageDependencies: new Map([
        ["detect-libc", "1.0.3"],
        ["mkdirp", "0.5.1"],
        ["needle", "2.2.4"],
        ["nopt", "4.0.1"],
        ["npm-packlist", "1.2.0"],
        ["npmlog", "4.1.2"],
        ["rc", "1.2.8"],
        ["rimraf", "2.6.3"],
        ["semver", "5.6.0"],
        ["tar", "4.4.8"],
        ["node-pre-gyp", "0.10.3"],
      ]),
    }],
  ])],
  ["detect-libc", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-detect-libc-1.0.3-fa137c4bd698edf55cd5cd02ac559f91a4c4ba9b/node_modules/detect-libc/"),
      packageDependencies: new Map([
        ["detect-libc", "1.0.3"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
      ]),
    }],
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minimist-1.1.3-3bedfd91a92d39016fcfaa1c681e8faa1a1efda8/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.1.3"],
      ]),
    }],
  ])],
  ["needle", new Map([
    ["2.2.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-needle-2.2.4-51931bff82533b1928b7d1d69e01f1b00ffd2a4e/node_modules/needle/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["iconv-lite", "0.4.24"],
        ["sax", "1.2.4"],
        ["needle", "2.2.4"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
    ["0.4.23", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.23-297871f63be507adcfbfca715d0cd0eed84e9a63/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.23"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["sax", new Map([
    ["1.2.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-sax-1.2.4-2816234e2378bddc4e5354fab5caa895df7100d9/node_modules/sax/"),
      packageDependencies: new Map([
        ["sax", "1.2.4"],
      ]),
    }],
  ])],
  ["nopt", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-nopt-4.0.1-d0d4685afd5415193c8c7505602d0d17cd64474d/node_modules/nopt/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
        ["osenv", "0.1.5"],
        ["nopt", "4.0.1"],
      ]),
    }],
  ])],
  ["abbrev", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8/node_modules/abbrev/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
      ]),
    }],
  ])],
  ["osenv", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-osenv-0.1.5-85cdfafaeb28e8677f416e287592b5f3f49ea410/node_modules/osenv/"),
      packageDependencies: new Map([
        ["os-homedir", "1.0.2"],
        ["os-tmpdir", "1.0.2"],
        ["osenv", "0.1.5"],
      ]),
    }],
  ])],
  ["os-homedir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3/node_modules/os-homedir/"),
      packageDependencies: new Map([
        ["os-homedir", "1.0.2"],
      ]),
    }],
  ])],
  ["os-tmpdir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
      ]),
    }],
  ])],
  ["npm-packlist", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-npm-packlist-1.2.0-55a60e793e272f00862c7089274439a4cc31fc7f/node_modules/npm-packlist/"),
      packageDependencies: new Map([
        ["ignore-walk", "3.0.1"],
        ["npm-bundled", "1.0.5"],
        ["npm-packlist", "1.2.0"],
      ]),
    }],
  ])],
  ["ignore-walk", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ignore-walk-3.0.1-a83e62e7d272ac0e3b551aaa82831a19b69f82f8/node_modules/ignore-walk/"),
      packageDependencies: new Map([
        ["minimatch", "3.0.4"],
        ["ignore-walk", "3.0.1"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["npm-bundled", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-npm-bundled-1.0.5-3c1732b7ba936b3a10325aef616467c0ccbcc979/node_modules/npm-bundled/"),
      packageDependencies: new Map([
        ["npm-bundled", "1.0.5"],
      ]),
    }],
  ])],
  ["npmlog", new Map([
    ["4.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-npmlog-4.1.2-08a7f2a8bf734604779a9efa4ad5cc717abb954b/node_modules/npmlog/"),
      packageDependencies: new Map([
        ["are-we-there-yet", "1.1.5"],
        ["console-control-strings", "1.1.0"],
        ["gauge", "2.7.4"],
        ["set-blocking", "2.0.0"],
        ["npmlog", "4.1.2"],
      ]),
    }],
  ])],
  ["are-we-there-yet", new Map([
    ["1.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-are-we-there-yet-1.1.5-4b35c2944f062a8bfcda66410760350fe9ddfc21/node_modules/are-we-there-yet/"),
      packageDependencies: new Map([
        ["delegates", "1.0.0"],
        ["readable-stream", "2.3.6"],
        ["are-we-there-yet", "1.1.5"],
      ]),
    }],
  ])],
  ["delegates", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a/node_modules/delegates/"),
      packageDependencies: new Map([
        ["delegates", "1.0.0"],
      ]),
    }],
  ])],
  ["console-control-strings", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-console-control-strings-1.1.0-3d7cf4464db6446ea644bf4b39507f9851008e8e/node_modules/console-control-strings/"),
      packageDependencies: new Map([
        ["console-control-strings", "1.1.0"],
      ]),
    }],
  ])],
  ["gauge", new Map([
    ["2.7.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-gauge-2.7.4-2c03405c7538c39d7eb37b317022e325fb018bf7/node_modules/gauge/"),
      packageDependencies: new Map([
        ["aproba", "1.2.0"],
        ["console-control-strings", "1.1.0"],
        ["has-unicode", "2.0.1"],
        ["object-assign", "4.1.1"],
        ["signal-exit", "3.0.2"],
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wide-align", "1.1.3"],
        ["gauge", "2.7.4"],
      ]),
    }],
  ])],
  ["aproba", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-aproba-1.2.0-6802e6264efd18c790a1b0d517f0f2627bf2c94a/node_modules/aproba/"),
      packageDependencies: new Map([
        ["aproba", "1.2.0"],
      ]),
    }],
  ])],
  ["has-unicode", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-unicode-2.0.1-e0e6fe6a28cf51138855e086d1691e771de2a8b9/node_modules/has-unicode/"),
      packageDependencies: new Map([
        ["has-unicode", "2.0.1"],
      ]),
    }],
  ])],
  ["object-assign", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/"),
      packageDependencies: new Map([
        ["object-assign", "4.1.1"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.2"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
        ["is-fullwidth-code-point", "1.0.0"],
        ["strip-ansi", "3.0.1"],
        ["string-width", "1.0.2"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "4.0.0"],
        ["string-width", "2.1.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-string-width-3.0.0-5a1690a57cc78211fffd9bf24bbe24d090604eb1/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "5.0.0"],
        ["string-width", "3.0.0"],
      ]),
    }],
  ])],
  ["code-point-at", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
        ["is-fullwidth-code-point", "1.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
      ]),
    }],
  ])],
  ["number-is-nan", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["strip-ansi", "3.0.1"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
        ["strip-ansi", "4.0.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-ansi-5.0.0-f78f68b5d0866c20b2c9b8c61b5298508dc8756f/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.0.0"],
        ["strip-ansi", "5.0.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ansi-regex-4.0.0-70de791edf021404c3fd615aa89118ae0432e5a9/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.0.0"],
      ]),
    }],
  ])],
  ["wide-align", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-wide-align-1.1.3-ae074e6bdc0c14a431e804e624549c633b000457/node_modules/wide-align/"),
      packageDependencies: new Map([
        ["string-width", "2.1.1"],
        ["wide-align", "1.1.3"],
      ]),
    }],
  ])],
  ["set-blocking", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/"),
      packageDependencies: new Map([
        ["set-blocking", "2.0.0"],
      ]),
    }],
  ])],
  ["rc", new Map([
    ["1.2.8", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed/node_modules/rc/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
        ["ini", "1.3.5"],
        ["minimist", "1.2.0"],
        ["strip-json-comments", "2.0.1"],
        ["rc", "1.2.8"],
      ]),
    }],
  ])],
  ["deep-extend", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac/node_modules/deep-extend/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
      ]),
    }],
  ])],
  ["ini", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
      ]),
    }],
  ])],
  ["strip-json-comments", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "2.0.1"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["2.6.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.3"],
        ["rimraf", "2.6.3"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-glob-7.1.3-3960832d3f1574108342dafd3a67b332c0969df1/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.3"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.3"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-semver-5.6.0-7e74256fbaa49c75aa7c7a205cc22799cac80004/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.6.0"],
      ]),
    }],
  ])],
  ["tar", new Map([
    ["4.4.8", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-tar-4.4.8-b19eec3fde2a96e64666df9fdb40c5ca1bc3747d/node_modules/tar/"),
      packageDependencies: new Map([
        ["chownr", "1.1.1"],
        ["fs-minipass", "1.2.5"],
        ["minipass", "2.3.5"],
        ["minizlib", "1.2.1"],
        ["mkdirp", "0.5.1"],
        ["safe-buffer", "5.1.2"],
        ["yallist", "3.0.3"],
        ["tar", "4.4.8"],
      ]),
    }],
  ])],
  ["chownr", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-chownr-1.1.1-54726b8b8fff4df053c42187e801fb4412df1494/node_modules/chownr/"),
      packageDependencies: new Map([
        ["chownr", "1.1.1"],
      ]),
    }],
  ])],
  ["fs-minipass", new Map([
    ["1.2.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fs-minipass-1.2.5-06c277218454ec288df77ada54a03b8702aacb9d/node_modules/fs-minipass/"),
      packageDependencies: new Map([
        ["minipass", "2.3.5"],
        ["fs-minipass", "1.2.5"],
      ]),
    }],
  ])],
  ["minipass", new Map([
    ["2.3.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minipass-2.3.5-cacebe492022497f656b0f0f51e2682a9ed2d848/node_modules/minipass/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["yallist", "3.0.3"],
        ["minipass", "2.3.5"],
      ]),
    }],
  ])],
  ["yallist", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yallist-3.0.3-b4b049e314be545e3ce802236d6cd22cd91c3de9/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "3.0.3"],
      ]),
    }],
  ])],
  ["minizlib", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minizlib-1.2.1-dd27ea6136243c7c880684e8672bb3a45fd9b614/node_modules/minizlib/"),
      packageDependencies: new Map([
        ["minipass", "2.3.5"],
        ["minizlib", "1.2.1"],
      ]),
    }],
  ])],
  ["connect", new Map([
    ["3.6.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-connect-3.6.6-09eff6c55af7236e137135a72574858b6786f524/node_modules/connect/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["finalhandler", "1.1.0"],
        ["parseurl", "1.3.2"],
        ["utils-merge", "1.0.1"],
        ["connect", "3.6.6"],
      ]),
    }],
  ])],
  ["finalhandler", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-finalhandler-1.1.0-ce0b6855b45853e791b2fcc680046d88253dd7f5/node_modules/finalhandler/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["on-finished", "2.3.0"],
        ["parseurl", "1.3.2"],
        ["statuses", "1.3.1"],
        ["unpipe", "1.0.0"],
        ["finalhandler", "1.1.0"],
      ]),
    }],
  ])],
  ["encodeurl", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59/node_modules/encodeurl/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
      ]),
    }],
  ])],
  ["escape-html", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.3"],
      ]),
    }],
  ])],
  ["on-finished", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
        ["on-finished", "2.3.0"],
      ]),
    }],
  ])],
  ["ee-first", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
      ]),
    }],
  ])],
  ["parseurl", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parseurl-1.3.2-fc289d4ed8993119460c156253262cdc8de65bf3/node_modules/parseurl/"),
      packageDependencies: new Map([
        ["parseurl", "1.3.2"],
      ]),
    }],
  ])],
  ["statuses", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-statuses-1.3.1-faf51b9eb74aaef3b3acf4ad5f61abf24cb7b93e/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.3.1"],
      ]),
    }],
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.5.0"],
      ]),
    }],
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-statuses-1.4.0-bb73d446da2796106efcc1b601a253d6c46bd087/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.4.0"],
      ]),
    }],
  ])],
  ["unpipe", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/"),
      packageDependencies: new Map([
        ["unpipe", "1.0.0"],
      ]),
    }],
  ])],
  ["utils-merge", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/"),
      packageDependencies: new Map([
        ["utils-merge", "1.0.1"],
      ]),
    }],
  ])],
  ["dev-ip", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-dev-ip-1.0.1-a76a3ed1855be7a012bb8ac16cb80f3c00dc28f0/node_modules/dev-ip/"),
      packageDependencies: new Map([
        ["dev-ip", "1.0.1"],
      ]),
    }],
  ])],
  ["easy-extender", new Map([
    ["2.3.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-easy-extender-2.3.4-298789b64f9aaba62169c77a2b3b64b4c9589b8f/node_modules/easy-extender/"),
      packageDependencies: new Map([
        ["lodash", "4.17.11"],
        ["easy-extender", "2.3.4"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.11", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-lodash-4.17.11-b39ea6229ef607ecd89e2c8df12536891cac9b8d/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.11"],
      ]),
    }],
  ])],
  ["eazy-logger", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-eazy-logger-3.0.2-a325aa5e53d13a2225889b2ac4113b2b9636f4fc/node_modules/eazy-logger/"),
      packageDependencies: new Map([
        ["tfunk", "3.1.0"],
        ["eazy-logger", "3.0.2"],
      ]),
    }],
  ])],
  ["tfunk", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-tfunk-3.1.0-38e4414fc64977d87afdaa72facb6d29f82f7b5b/node_modules/tfunk/"),
      packageDependencies: new Map([
        ["chalk", "1.1.3"],
        ["object-path", "0.9.2"],
        ["tfunk", "3.1.0"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["has-ansi", "2.0.0"],
        ["strip-ansi", "3.0.1"],
        ["supports-color", "2.0.0"],
        ["chalk", "1.1.3"],
      ]),
    }],
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["ansi-styles", "2.2.1"],
      ]),
    }],
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["has-ansi", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["has-ansi", "2.0.0"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["supports-color", "2.0.0"],
      ]),
    }],
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-supports-color-6.1.0-0764abc69c63d5ac842dd4867e8d025e880df8f3/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "6.1.0"],
      ]),
    }],
  ])],
  ["object-path", new Map([
    ["0.9.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-path-0.9.2-0fd9a74fc5fad1ae3968b586bda5c632bd6c05a5/node_modules/object-path/"),
      packageDependencies: new Map([
        ["object-path", "0.9.2"],
      ]),
    }],
  ])],
  ["fs-extra", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fs-extra-3.0.1-3794f378c58b342ea7dbbb23095109c4b3b62291/node_modules/fs-extra/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["jsonfile", "3.0.1"],
        ["universalify", "0.1.2"],
        ["fs-extra", "3.0.1"],
      ]),
    }],
  ])],
  ["jsonfile", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-jsonfile-3.0.1-a5ecc6f65f53f662c4415c7675a0331d0992ec66/node_modules/jsonfile/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["jsonfile", "3.0.1"],
      ]),
    }],
  ])],
  ["universalify", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/"),
      packageDependencies: new Map([
        ["universalify", "0.1.2"],
      ]),
    }],
  ])],
  ["http-proxy", new Map([
    ["1.15.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-http-proxy-1.15.2-642fdcaffe52d3448d2bda3b0079e9409064da31/node_modules/http-proxy/"),
      packageDependencies: new Map([
        ["eventemitter3", "1.2.0"],
        ["requires-port", "1.0.0"],
        ["http-proxy", "1.15.2"],
      ]),
    }],
  ])],
  ["eventemitter3", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-eventemitter3-1.2.0-1c86991d816ad1e504750e73874224ecf3bec508/node_modules/eventemitter3/"),
      packageDependencies: new Map([
        ["eventemitter3", "1.2.0"],
      ]),
    }],
  ])],
  ["requires-port", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff/node_modules/requires-port/"),
      packageDependencies: new Map([
        ["requires-port", "1.0.0"],
      ]),
    }],
  ])],
  ["localtunnel", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-localtunnel-1.9.1-1d1737eab658add5a40266d8e43f389b646ee3b1/node_modules/localtunnel/"),
      packageDependencies: new Map([
        ["axios", "0.17.1"],
        ["debug", "2.6.9"],
        ["openurl", "1.1.1"],
        ["yargs", "6.6.0"],
        ["localtunnel", "1.9.1"],
      ]),
    }],
  ])],
  ["axios", new Map([
    ["0.17.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-axios-0.17.1-2d8e3e5d0bdbd7327f91bc814f5c57660f81824d/node_modules/axios/"),
      packageDependencies: new Map([
        ["follow-redirects", "1.6.1"],
        ["is-buffer", "1.1.6"],
        ["axios", "0.17.1"],
      ]),
    }],
  ])],
  ["follow-redirects", new Map([
    ["1.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-follow-redirects-1.6.1-514973c44b5757368bad8bddfe52f81f015c94cb/node_modules/follow-redirects/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["follow-redirects", "1.6.1"],
      ]),
    }],
  ])],
  ["openurl", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-openurl-1.1.1-3875b4b0ef7a52c156f0db41d4609dbb0f94b387/node_modules/openurl/"),
      packageDependencies: new Map([
        ["openurl", "1.1.1"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["6.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yargs-6.6.0-782ec21ef403345f830a808ca3d513af56065208/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["cliui", "3.2.0"],
        ["decamelize", "1.2.0"],
        ["get-caller-file", "1.0.3"],
        ["os-locale", "1.4.0"],
        ["read-pkg-up", "1.0.1"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "1.0.1"],
        ["set-blocking", "2.0.0"],
        ["string-width", "1.0.2"],
        ["which-module", "1.0.0"],
        ["y18n", "3.2.1"],
        ["yargs-parser", "4.2.1"],
        ["yargs", "6.6.0"],
      ]),
    }],
    ["6.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yargs-6.4.0-816e1a866d5598ccf34e5596ddce22d92da490d4/node_modules/yargs/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["cliui", "3.2.0"],
        ["decamelize", "1.2.0"],
        ["get-caller-file", "1.0.3"],
        ["os-locale", "1.4.0"],
        ["read-pkg-up", "1.0.1"],
        ["require-directory", "2.1.1"],
        ["require-main-filename", "1.0.1"],
        ["set-blocking", "2.0.0"],
        ["string-width", "1.0.2"],
        ["which-module", "1.0.0"],
        ["window-size", "0.2.0"],
        ["y18n", "3.2.1"],
        ["yargs-parser", "4.2.1"],
        ["yargs", "6.4.0"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-camelcase-4.1.0-d545635be1e33c542649c69173e5de6acfae34dd/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
        ["cliui", "3.2.0"],
      ]),
    }],
  ])],
  ["wrap-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wrap-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
      ]),
    }],
  ])],
  ["get-caller-file", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/"),
      packageDependencies: new Map([
        ["get-caller-file", "1.0.3"],
      ]),
    }],
  ])],
  ["os-locale", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/"),
      packageDependencies: new Map([
        ["lcid", "1.0.0"],
        ["os-locale", "1.4.0"],
      ]),
    }],
  ])],
  ["lcid", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
        ["lcid", "1.0.0"],
      ]),
    }],
  ])],
  ["invert-kv", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/"),
      packageDependencies: new Map([
        ["invert-kv", "1.0.0"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "1.1.2"],
        ["read-pkg", "1.1.0"],
        ["read-pkg-up", "1.0.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-read-pkg-up-3.0.0-3ed496685dba0f8fe118d0691dc51f4a1ff96f07/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["read-pkg", "3.0.0"],
        ["read-pkg-up", "3.0.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/"),
      packageDependencies: new Map([
        ["path-exists", "2.1.0"],
        ["pinkie-promise", "2.0.1"],
        ["find-up", "1.1.2"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "2.0.0"],
        ["find-up", "2.1.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["pinkie-promise", "2.0.1"],
        ["path-exists", "2.1.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "3.0.0"],
      ]),
    }],
  ])],
  ["pinkie-promise", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
        ["pinkie-promise", "2.0.1"],
      ]),
    }],
  ])],
  ["pinkie", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/"),
      packageDependencies: new Map([
        ["pinkie", "2.0.4"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "1.1.0"],
        ["normalize-package-data", "2.4.0"],
        ["path-type", "1.1.0"],
        ["read-pkg", "1.1.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-read-pkg-3.0.0-9cbc686978fee65d16c00e2b19c237fcf6e38389/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "4.0.0"],
        ["normalize-package-data", "2.4.0"],
        ["path-type", "3.0.0"],
        ["read-pkg", "3.0.0"],
      ]),
    }],
  ])],
  ["load-json-file", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["parse-json", "2.2.0"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["strip-bom", "2.0.0"],
        ["load-json-file", "1.1.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-load-json-file-4.0.0-2f5f45ab91e33216234fd53adab668eb4ec0993b/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["parse-json", "4.0.0"],
        ["pify", "3.0.0"],
        ["strip-bom", "3.0.0"],
        ["load-json-file", "4.0.0"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["parse-json", "2.2.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parse-json-4.0.0-be35f5425be1f7f6c747184f98a788cb99477ee0/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["json-parse-better-errors", "1.0.2"],
        ["parse-json", "4.0.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["pify", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pify-3.0.0-e5a4acd2c101fdf3d9a4d07f0dbc4db49dd28176/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "3.0.0"],
      ]),
    }],
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-pify-4.0.1-4b2cd25c50d598735c50292224fd8c6df41e3231/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "4.0.1"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
        ["strip-bom", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["strip-bom", "3.0.0"],
      ]),
    }],
  ])],
  ["is-utf8", new Map([
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/"),
      packageDependencies: new Map([
        ["is-utf8", "0.2.1"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.4.0-12f95a307d58352075a04907b84ac8be98ac012f/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.7.1"],
        ["is-builtin-module", "1.0.0"],
        ["semver", "5.6.0"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.4.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.7.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.7.1-97f236977bd6e125408930ff6de3eec6281ec047/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.7.1"],
      ]),
    }],
  ])],
  ["is-builtin-module", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-builtin-module-1.0.0-540572d34f7ac3119f8f76c30cbc1b1e037affbe/node_modules/is-builtin-module/"),
      packageDependencies: new Map([
        ["builtin-modules", "1.1.1"],
        ["is-builtin-module", "1.0.0"],
      ]),
    }],
  ])],
  ["builtin-modules", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-builtin-modules-1.1.1-270f076c5a72c02f5b65a47df94c5fe3a278892f/node_modules/builtin-modules/"),
      packageDependencies: new Map([
        ["builtin-modules", "1.1.1"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.0"],
        ["spdx-expression-parse", "3.0.0"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.0"],
        ["spdx-license-ids", "3.0.3"],
        ["spdx-correct", "3.1.0"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
        ["spdx-license-ids", "3.0.3"],
        ["spdx-expression-parse", "3.0.0"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.3-81c0ce8f21474756148bbb5f3bfc0f36bf15d76e/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.3"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.1.15"],
        ["pify", "2.3.0"],
        ["pinkie-promise", "2.0.1"],
        ["path-type", "1.1.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-type-3.0.0-cef31dc8e0a1a3bb0d105c0cd97cf3bf47f4e36f/node_modules/path-type/"),
      packageDependencies: new Map([
        ["pify", "3.0.0"],
        ["path-type", "3.0.0"],
      ]),
    }],
  ])],
  ["require-directory", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/"),
      packageDependencies: new Map([
        ["require-directory", "2.1.1"],
      ]),
    }],
  ])],
  ["require-main-filename", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/"),
      packageDependencies: new Map([
        ["require-main-filename", "1.0.1"],
      ]),
    }],
  ])],
  ["which-module", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/"),
      packageDependencies: new Map([
        ["which-module", "1.0.0"],
      ]),
    }],
  ])],
  ["y18n", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/"),
      packageDependencies: new Map([
        ["y18n", "3.2.1"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yargs-parser-4.2.1-29cceac0dc4f03c6c87b4a9f217dd18c9f74871c/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "3.0.0"],
        ["yargs-parser", "4.2.1"],
      ]),
    }],
    ["10.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-yargs-parser-10.1.0-7202265b89f7e9e9f2e5765e0fe735a905edbaa8/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
        ["yargs-parser", "10.1.0"],
      ]),
    }],
  ])],
  ["expand-range", new Map([
    ["1.8.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-expand-range-1.8.2-a299effd335fe2721ebae8e257ec79644fc85337/node_modules/expand-range/"),
      packageDependencies: new Map([
        ["fill-range", "2.2.4"],
        ["expand-range", "1.8.2"],
      ]),
    }],
  ])],
  ["randomatic", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-randomatic-3.1.1-b776efc59375984e36c537b2f51a1f0aff0da1ed/node_modules/randomatic/"),
      packageDependencies: new Map([
        ["is-number", "4.0.0"],
        ["kind-of", "6.0.2"],
        ["math-random", "1.0.4"],
        ["randomatic", "3.1.1"],
      ]),
    }],
  ])],
  ["math-random", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-math-random-1.0.4-5dd6943c938548267016d4e34f057583080c514c/node_modules/math-random/"),
      packageDependencies: new Map([
        ["math-random", "1.0.4"],
      ]),
    }],
  ])],
  ["preserve", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-preserve-0.2.0-815ed1f6ebc65926f865b310c0713bcb3315ce4b/node_modules/preserve/"),
      packageDependencies: new Map([
        ["preserve", "0.2.0"],
      ]),
    }],
  ])],
  ["is-posix-bracket", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-posix-bracket-0.1.1-3334dc79774368e92f016e6fbc0a88f5cd6e6bc4/node_modules/is-posix-bracket/"),
      packageDependencies: new Map([
        ["is-posix-bracket", "0.1.1"],
      ]),
    }],
  ])],
  ["filename-regex", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-filename-regex-2.0.1-c1c4b9bee3e09725ddb106b75c1e301fe2f18b26/node_modules/filename-regex/"),
      packageDependencies: new Map([
        ["filename-regex", "2.0.1"],
      ]),
    }],
  ])],
  ["object.omit", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-object-omit-2.0.1-1a9c744829f39dbb858c76ca3579ae2a54ebd1fa/node_modules/object.omit/"),
      packageDependencies: new Map([
        ["for-own", "0.1.5"],
        ["is-extendable", "0.1.1"],
        ["object.omit", "2.0.1"],
      ]),
    }],
  ])],
  ["for-own", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-for-own-0.1.5-5265c681a4f294dabbf17c9509b6763aa84510ce/node_modules/for-own/"),
      packageDependencies: new Map([
        ["for-in", "1.0.2"],
        ["for-own", "0.1.5"],
      ]),
    }],
  ])],
  ["parse-glob", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parse-glob-3.0.4-b2c376cfb11f35513badd173ef0bb6e3a388391c/node_modules/parse-glob/"),
      packageDependencies: new Map([
        ["glob-base", "0.3.0"],
        ["is-dotfile", "1.0.3"],
        ["is-extglob", "1.0.0"],
        ["is-glob", "2.0.1"],
        ["parse-glob", "3.0.4"],
      ]),
    }],
  ])],
  ["glob-base", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-glob-base-0.3.0-dbb164f6221b1c0b1ccf82aea328b497df0ea3c4/node_modules/glob-base/"),
      packageDependencies: new Map([
        ["glob-parent", "2.0.0"],
        ["is-glob", "2.0.1"],
        ["glob-base", "0.3.0"],
      ]),
    }],
  ])],
  ["is-dotfile", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-dotfile-1.0.3-a6a2f32ffd2dfb04f5ca25ecd0f6b83cf798a1e1/node_modules/is-dotfile/"),
      packageDependencies: new Map([
        ["is-dotfile", "1.0.3"],
      ]),
    }],
  ])],
  ["regex-cache", new Map([
    ["0.4.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-regex-cache-0.4.4-75bdc58a2a1496cec48a12835bc54c8d562336dd/node_modules/regex-cache/"),
      packageDependencies: new Map([
        ["is-equal-shallow", "0.1.3"],
        ["regex-cache", "0.4.4"],
      ]),
    }],
  ])],
  ["is-equal-shallow", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-equal-shallow-0.1.3-2238098fc221de0bcfa5d9eac4c45d638aa1c534/node_modules/is-equal-shallow/"),
      packageDependencies: new Map([
        ["is-primitive", "2.0.0"],
        ["is-equal-shallow", "0.1.3"],
      ]),
    }],
  ])],
  ["is-primitive", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-primitive-2.0.0-207bab91638499c07b2adf240a41a87210034575/node_modules/is-primitive/"),
      packageDependencies: new Map([
        ["is-primitive", "2.0.0"],
      ]),
    }],
  ])],
  ["opn", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-opn-5.3.0-64871565c863875f052cfdf53d3e3cb5adb53b1c/node_modules/opn/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
        ["opn", "5.3.0"],
      ]),
    }],
  ])],
  ["is-wsl", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/"),
      packageDependencies: new Map([
        ["is-wsl", "1.1.0"],
      ]),
    }],
  ])],
  ["portscanner", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-portscanner-2.1.1-eabb409e4de24950f5a2a516d35ae769343fbb96/node_modules/portscanner/"),
      packageDependencies: new Map([
        ["async", "1.5.2"],
        ["is-number-like", "1.0.8"],
        ["portscanner", "2.1.1"],
      ]),
    }],
  ])],
  ["async", new Map([
    ["1.5.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/"),
      packageDependencies: new Map([
        ["async", "1.5.2"],
      ]),
    }],
  ])],
  ["is-number-like", new Map([
    ["1.0.8", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-number-like-1.0.8-2e129620b50891042e44e9bbbb30593e75cfbbe3/node_modules/is-number-like/"),
      packageDependencies: new Map([
        ["lodash.isfinite", "3.3.2"],
        ["is-number-like", "1.0.8"],
      ]),
    }],
  ])],
  ["lodash.isfinite", new Map([
    ["3.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-lodash-isfinite-3.3.2-fb89b65a9a80281833f0b7478b3a5104f898ebb3/node_modules/lodash.isfinite/"),
      packageDependencies: new Map([
        ["lodash.isfinite", "3.3.2"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["6.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-qs-6.2.3-1cfcb25c10a9b2b483053ff39f5dfc9233908cfe/node_modules/qs/"),
      packageDependencies: new Map([
        ["qs", "6.2.3"],
      ]),
    }],
  ])],
  ["raw-body", new Map([
    ["2.3.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-raw-body-2.3.3-1b324ece6b5706e153855bc1148c65bb7f6ea0c3/node_modules/raw-body/"),
      packageDependencies: new Map([
        ["bytes", "3.0.0"],
        ["http-errors", "1.6.3"],
        ["iconv-lite", "0.4.23"],
        ["unpipe", "1.0.0"],
        ["raw-body", "2.3.3"],
      ]),
    }],
  ])],
  ["bytes", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "3.0.0"],
      ]),
    }],
  ])],
  ["http-errors", new Map([
    ["1.6.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.3"],
        ["setprototypeof", "1.1.0"],
        ["statuses", "1.5.0"],
        ["http-errors", "1.6.3"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
      ]),
    }],
  ])],
  ["setprototypeof", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.0"],
      ]),
    }],
  ])],
  ["resp-modifier", new Map([
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-resp-modifier-6.0.2-b124de5c4fbafcba541f48ffa73970f4aa456b4f/node_modules/resp-modifier/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["minimatch", "3.0.4"],
        ["resp-modifier", "6.0.2"],
      ]),
    }],
  ])],
  ["rx", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-rx-4.1.0-a5f13ff79ef3b740fe30aa803fb09f98805d4782/node_modules/rx/"),
      packageDependencies: new Map([
        ["rx", "4.1.0"],
      ]),
    }],
  ])],
  ["send", new Map([
    ["0.16.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-send-0.16.2-6ecca1e0f8c156d141597559848df64730a6bbc1/node_modules/send/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["depd", "1.1.2"],
        ["destroy", "1.0.4"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["http-errors", "1.6.3"],
        ["mime", "1.4.1"],
        ["ms", "2.0.0"],
        ["on-finished", "2.3.0"],
        ["range-parser", "1.2.0"],
        ["statuses", "1.4.0"],
        ["send", "0.16.2"],
      ]),
    }],
  ])],
  ["destroy", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/"),
      packageDependencies: new Map([
        ["destroy", "1.0.4"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mime-1.4.1-121f9ebc49e3766f311a76e1fa1c8003c4b03aa6/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.4.1"],
      ]),
    }],
  ])],
  ["range-parser", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-range-parser-1.2.0-f49be6b487894ddc40dcc94a322f611092e00d5e/node_modules/range-parser/"),
      packageDependencies: new Map([
        ["range-parser", "1.2.0"],
      ]),
    }],
  ])],
  ["serve-index", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239/node_modules/serve-index/"),
      packageDependencies: new Map([
        ["accepts", "1.3.5"],
        ["batch", "0.6.1"],
        ["debug", "2.6.9"],
        ["escape-html", "1.0.3"],
        ["http-errors", "1.6.3"],
        ["mime-types", "2.1.21"],
        ["parseurl", "1.3.2"],
        ["serve-index", "1.9.1"],
      ]),
    }],
  ])],
  ["accepts", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-accepts-1.3.5-eb777df6011723a3b14e8a72c0805c8e86746bd2/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.21"],
        ["negotiator", "0.6.1"],
        ["accepts", "1.3.5"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.21", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mime-types-2.1.21-28995aa1ecb770742fe6ae7e58f9181c744b3f96/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.37.0"],
        ["mime-types", "2.1.21"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.37.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mime-db-1.37.0-0b6a0ce6fdbe9576e25f1f2d2fde8830dc0ad0d8/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.37.0"],
      ]),
    }],
  ])],
  ["negotiator", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-negotiator-0.6.1-2b327184e8992101177b28563fb5e7102acd0ca9/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.6.1"],
      ]),
    }],
  ])],
  ["batch", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16/node_modules/batch/"),
      packageDependencies: new Map([
        ["batch", "0.6.1"],
      ]),
    }],
  ])],
  ["serve-static", new Map([
    ["1.13.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-serve-static-1.13.2-095e8472fd5b46237db50ce486a43f4b86c6cec1/node_modules/serve-static/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["parseurl", "1.3.2"],
        ["send", "0.16.2"],
        ["serve-static", "1.13.2"],
      ]),
    }],
  ])],
  ["socket.io", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-2.1.1-a069c5feabee3e6b214a75b40ce0652e1cfb9980/node_modules/socket.io/"),
      packageDependencies: new Map([
        ["debug", "3.1.0"],
        ["engine.io", "3.2.1"],
        ["has-binary2", "1.0.3"],
        ["socket.io-adapter", "1.1.1"],
        ["socket.io-client", "2.1.1"],
        ["socket.io-parser", "3.2.0"],
        ["socket.io", "2.1.1"],
      ]),
    }],
  ])],
  ["engine.io", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-engine-io-3.2.1-b60281c35484a70ee0351ea0ebff83ec8c9522a2/node_modules/engine.io/"),
      packageDependencies: new Map([
        ["accepts", "1.3.5"],
        ["base64id", "1.0.0"],
        ["debug", "3.1.0"],
        ["engine.io-parser", "2.1.3"],
        ["ws", "3.3.3"],
        ["cookie", "0.3.1"],
        ["engine.io", "3.2.1"],
      ]),
    }],
  ])],
  ["base64id", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-base64id-1.0.0-47688cb99bb6804f0e06d3e763b1c32e57d8e6b6/node_modules/base64id/"),
      packageDependencies: new Map([
        ["base64id", "1.0.0"],
      ]),
    }],
  ])],
  ["ultron", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ultron-1.1.1-9fe1536a10a664a65266a1e3ccf85fd36302bc9c/node_modules/ultron/"),
      packageDependencies: new Map([
        ["ultron", "1.1.1"],
      ]),
    }],
  ])],
  ["cookie", new Map([
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-cookie-0.3.1-e7e0a1f9ef43b4c8ba925c5c5a96e806d16873bb/node_modules/cookie/"),
      packageDependencies: new Map([
        ["cookie", "0.3.1"],
      ]),
    }],
  ])],
  ["socket.io-adapter", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-socket-io-adapter-1.1.1-2a805e8a14d6372124dd9159ad4502f8cb07f06b/node_modules/socket.io-adapter/"),
      packageDependencies: new Map([
        ["socket.io-adapter", "1.1.1"],
      ]),
    }],
  ])],
  ["ua-parser-js", new Map([
    ["0.7.17", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ua-parser-js-0.7.17-e9ec5f9498b9ec910e7ae3ac626a805c4d09ecac/node_modules/ua-parser-js/"),
      packageDependencies: new Map([
        ["ua-parser-js", "0.7.17"],
      ]),
    }],
  ])],
  ["window-size", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/"),
      packageDependencies: new Map([
        ["window-size", "0.2.0"],
      ]),
    }],
  ])],
  ["stylelint", new Map([
    ["9.10.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-stylelint-9.10.1-5f0ee3701461dff1d68284e1386efe8f0677a75d/node_modules/stylelint/"),
      packageDependencies: new Map([
        ["autoprefixer", "9.4.6"],
        ["balanced-match", "1.0.0"],
        ["chalk", "2.4.2"],
        ["cosmiconfig", "5.0.7"],
        ["debug", "4.1.1"],
        ["execall", "1.0.0"],
        ["file-entry-cache", "4.0.0"],
        ["get-stdin", "6.0.0"],
        ["global-modules", "2.0.0"],
        ["globby", "9.0.0"],
        ["globjoin", "0.1.4"],
        ["html-tags", "2.0.0"],
        ["ignore", "5.0.5"],
        ["import-lazy", "3.1.0"],
        ["imurmurhash", "0.1.4"],
        ["known-css-properties", "0.11.0"],
        ["leven", "2.1.0"],
        ["lodash", "4.17.11"],
        ["log-symbols", "2.2.0"],
        ["mathml-tag-names", "2.1.0"],
        ["meow", "5.0.0"],
        ["micromatch", "3.1.10"],
        ["normalize-selector", "0.2.0"],
        ["pify", "4.0.1"],
        ["postcss", "7.0.14"],
        ["postcss-html", "0.36.0"],
        ["postcss-jsx", "0.36.0"],
        ["postcss-less", "3.1.2"],
        ["postcss-markdown", "0.36.0"],
        ["postcss-media-query-parser", "0.2.3"],
        ["postcss-reporter", "6.0.1"],
        ["postcss-resolve-nested-selector", "0.1.1"],
        ["postcss-safe-parser", "4.0.1"],
        ["postcss-sass", "0.3.5"],
        ["postcss-scss", "2.0.0"],
        ["postcss-selector-parser", "3.1.1"],
        ["postcss-syntax", "0.36.2"],
        ["postcss-value-parser", "3.3.1"],
        ["resolve-from", "4.0.0"],
        ["signal-exit", "3.0.2"],
        ["slash", "2.0.0"],
        ["specificity", "0.4.1"],
        ["string-width", "3.0.0"],
        ["style-search", "0.1.0"],
        ["sugarss", "2.0.0"],
        ["svg-tags", "1.0.0"],
        ["table", "5.2.2"],
        ["stylelint", "9.10.1"],
      ]),
    }],
  ])],
  ["autoprefixer", new Map([
    ["9.4.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-autoprefixer-9.4.6-0ace275e33b37de16b09a5547dbfe73a98c1d446/node_modules/autoprefixer/"),
      packageDependencies: new Map([
        ["browserslist", "4.4.1"],
        ["caniuse-lite", "1.0.30000932"],
        ["normalize-range", "0.1.2"],
        ["num2fraction", "1.2.2"],
        ["postcss", "7.0.14"],
        ["postcss-value-parser", "3.3.1"],
        ["autoprefixer", "9.4.6"],
      ]),
    }],
  ])],
  ["browserslist", new Map([
    ["4.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-browserslist-4.4.1-42e828954b6b29a7a53e352277be429478a69062/node_modules/browserslist/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30000932"],
        ["electron-to-chromium", "1.3.108"],
        ["node-releases", "1.1.5"],
        ["browserslist", "4.4.1"],
      ]),
    }],
  ])],
  ["caniuse-lite", new Map([
    ["1.0.30000932", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-caniuse-lite-1.0.30000932-d01763e9ce77810962ca7391ff827b5949ce4272/node_modules/caniuse-lite/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30000932"],
      ]),
    }],
  ])],
  ["electron-to-chromium", new Map([
    ["1.3.108", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-electron-to-chromium-1.3.108-2e79a6fcaa4b3e7c75abf871505bda8e268c910e/node_modules/electron-to-chromium/"),
      packageDependencies: new Map([
        ["electron-to-chromium", "1.3.108"],
      ]),
    }],
  ])],
  ["node-releases", new Map([
    ["1.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-node-releases-1.1.5-1dbee1380742125fe99e0476c456670bf3590b89/node_modules/node-releases/"),
      packageDependencies: new Map([
        ["semver", "5.6.0"],
        ["node-releases", "1.1.5"],
      ]),
    }],
  ])],
  ["normalize-range", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-normalize-range-0.1.2-2d10c06bdfd312ea9777695a4d28439456b75942/node_modules/normalize-range/"),
      packageDependencies: new Map([
        ["normalize-range", "0.1.2"],
      ]),
    }],
  ])],
  ["num2fraction", new Map([
    ["1.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-num2fraction-1.2.2-6f682b6a027a4e9ddfa4564cd2589d1d4e669ede/node_modules/num2fraction/"),
      packageDependencies: new Map([
        ["num2fraction", "1.2.2"],
      ]),
    }],
  ])],
  ["postcss", new Map([
    ["7.0.14", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-7.0.14-4527ed6b1ca0d82c53ce5ec1a2041c2346bbd6e5/node_modules/postcss/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["source-map", "0.6.1"],
        ["supports-color", "6.1.0"],
        ["postcss", "7.0.14"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
  ])],
  ["postcss-value-parser", new Map([
    ["3.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-value-parser-3.3.1-9ff822547e2893213cf1c30efa51ac5fd1ba8281/node_modules/postcss-value-parser/"),
      packageDependencies: new Map([
        ["postcss-value-parser", "3.3.1"],
      ]),
    }],
  ])],
  ["cosmiconfig", new Map([
    ["5.0.7", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-cosmiconfig-5.0.7-39826b292ee0d78eda137dfa3173bd1c21a43b04/node_modules/cosmiconfig/"),
      packageDependencies: new Map([
        ["import-fresh", "2.0.0"],
        ["is-directory", "0.3.1"],
        ["js-yaml", "3.12.1"],
        ["parse-json", "4.0.0"],
        ["cosmiconfig", "5.0.7"],
      ]),
    }],
  ])],
  ["import-fresh", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-import-fresh-2.0.0-d81355c15612d386c61f9ddd3922d4304822a546/node_modules/import-fresh/"),
      packageDependencies: new Map([
        ["caller-path", "2.0.0"],
        ["resolve-from", "3.0.0"],
        ["import-fresh", "2.0.0"],
      ]),
    }],
  ])],
  ["caller-path", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-caller-path-2.0.0-468f83044e369ab2010fac5f06ceee15bb2cb1f4/node_modules/caller-path/"),
      packageDependencies: new Map([
        ["caller-callsite", "2.0.0"],
        ["caller-path", "2.0.0"],
      ]),
    }],
  ])],
  ["caller-callsite", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-caller-callsite-2.0.0-847e0fce0a223750a9a027c54b33731ad3154134/node_modules/caller-callsite/"),
      packageDependencies: new Map([
        ["callsites", "2.0.0"],
        ["caller-callsite", "2.0.0"],
      ]),
    }],
  ])],
  ["callsites", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-callsites-2.0.0-06eb84f00eea413da86affefacbffb36093b3c50/node_modules/callsites/"),
      packageDependencies: new Map([
        ["callsites", "2.0.0"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-resolve-from-3.0.0-b22c7af7d9d6881bc8b6e653335eebcb0a188748/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "3.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "4.0.0"],
      ]),
    }],
  ])],
  ["is-directory", new Map([
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-directory-0.3.1-61339b6f2475fc772fd9c9d83f5c8575dc154ae1/node_modules/is-directory/"),
      packageDependencies: new Map([
        ["is-directory", "0.3.1"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["3.12.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-js-yaml-3.12.1-295c8632a18a23e054cf5c9d3cecafe678167600/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "4.0.1"],
        ["js-yaml", "3.12.1"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["esprima", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
      ]),
    }],
  ])],
  ["json-parse-better-errors", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-json-parse-better-errors-1.0.2-bb867cfb3450e69107c131d1c514bab3dc8bcaa9/node_modules/json-parse-better-errors/"),
      packageDependencies: new Map([
        ["json-parse-better-errors", "1.0.2"],
      ]),
    }],
  ])],
  ["execall", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-execall-1.0.0-73d0904e395b3cab0658b08d09ec25307f29bb73/node_modules/execall/"),
      packageDependencies: new Map([
        ["clone-regexp", "1.0.1"],
        ["execall", "1.0.0"],
      ]),
    }],
  ])],
  ["clone-regexp", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-clone-regexp-1.0.1-051805cd33173375d82118fc0918606da39fd60f/node_modules/clone-regexp/"),
      packageDependencies: new Map([
        ["is-regexp", "1.0.0"],
        ["is-supported-regexp-flag", "1.0.1"],
        ["clone-regexp", "1.0.1"],
      ]),
    }],
  ])],
  ["is-regexp", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-regexp-1.0.0-fd2d883545c46bac5a633e7b9a09e87fa2cb5069/node_modules/is-regexp/"),
      packageDependencies: new Map([
        ["is-regexp", "1.0.0"],
      ]),
    }],
  ])],
  ["is-supported-regexp-flag", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-supported-regexp-flag-1.0.1-21ee16518d2c1dd3edd3e9a0d57e50207ac364ca/node_modules/is-supported-regexp-flag/"),
      packageDependencies: new Map([
        ["is-supported-regexp-flag", "1.0.1"],
      ]),
    }],
  ])],
  ["file-entry-cache", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-file-entry-cache-4.0.0-633567d15364aefe0b299e1e217735e8f3a9f6e8/node_modules/file-entry-cache/"),
      packageDependencies: new Map([
        ["flat-cache", "2.0.1"],
        ["file-entry-cache", "4.0.0"],
      ]),
    }],
  ])],
  ["flat-cache", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0/node_modules/flat-cache/"),
      packageDependencies: new Map([
        ["flatted", "2.0.0"],
        ["rimraf", "2.6.3"],
        ["write", "1.0.3"],
        ["flat-cache", "2.0.1"],
      ]),
    }],
  ])],
  ["flatted", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-flatted-2.0.0-55122b6536ea496b4b44893ee2608141d10d9916/node_modules/flatted/"),
      packageDependencies: new Map([
        ["flatted", "2.0.0"],
      ]),
    }],
  ])],
  ["write", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3/node_modules/write/"),
      packageDependencies: new Map([
        ["mkdirp", "0.5.1"],
        ["write", "1.0.3"],
      ]),
    }],
  ])],
  ["get-stdin", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-get-stdin-6.0.0-9e09bf712b360ab9225e812048f71fde9c89657b/node_modules/get-stdin/"),
      packageDependencies: new Map([
        ["get-stdin", "6.0.0"],
      ]),
    }],
  ])],
  ["global-modules", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-global-modules-2.0.0-997605ad2345f27f51539bea26574421215c7780/node_modules/global-modules/"),
      packageDependencies: new Map([
        ["global-prefix", "3.0.0"],
        ["global-modules", "2.0.0"],
      ]),
    }],
  ])],
  ["global-prefix", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-global-prefix-3.0.0-fc85f73064df69f50421f47f883fe5b913ba9b97/node_modules/global-prefix/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
        ["kind-of", "6.0.2"],
        ["which", "1.3.1"],
        ["global-prefix", "3.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["globby", new Map([
    ["9.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-globby-9.0.0-3800df736dc711266df39b4ce33fe0d481f94c23/node_modules/globby/"),
      packageDependencies: new Map([
        ["array-union", "1.0.2"],
        ["dir-glob", "2.2.2"],
        ["fast-glob", "2.2.6"],
        ["glob", "7.1.3"],
        ["ignore", "4.0.6"],
        ["pify", "4.0.1"],
        ["slash", "2.0.0"],
        ["globby", "9.0.0"],
      ]),
    }],
  ])],
  ["array-union", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-array-union-1.0.2-9a34410e4f4e3da23dea375be5be70f24778ec39/node_modules/array-union/"),
      packageDependencies: new Map([
        ["array-uniq", "1.0.3"],
        ["array-union", "1.0.2"],
      ]),
    }],
  ])],
  ["array-uniq", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-array-uniq-1.0.3-af6ac877a25cc7f74e058894753858dfdb24fdb6/node_modules/array-uniq/"),
      packageDependencies: new Map([
        ["array-uniq", "1.0.3"],
      ]),
    }],
  ])],
  ["dir-glob", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-dir-glob-2.2.2-fa09f0694153c8918b18ba0deafae94769fc50c4/node_modules/dir-glob/"),
      packageDependencies: new Map([
        ["path-type", "3.0.0"],
        ["dir-glob", "2.2.2"],
      ]),
    }],
  ])],
  ["fast-glob", new Map([
    ["2.2.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fast-glob-2.2.6-a5d5b697ec8deda468d85a74035290a025a95295/node_modules/fast-glob/"),
      packageDependencies: new Map([
        ["@mrmlnc/readdir-enhanced", "2.2.1"],
        ["@nodelib/fs.stat", "1.1.3"],
        ["glob-parent", "3.1.0"],
        ["is-glob", "4.0.0"],
        ["merge2", "1.2.3"],
        ["micromatch", "3.1.10"],
        ["fast-glob", "2.2.6"],
      ]),
    }],
  ])],
  ["@mrmlnc/readdir-enhanced", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@mrmlnc-readdir-enhanced-2.2.1-524af240d1a360527b730475ecfa1344aa540dde/node_modules/@mrmlnc/readdir-enhanced/"),
      packageDependencies: new Map([
        ["call-me-maybe", "1.0.1"],
        ["glob-to-regexp", "0.3.0"],
        ["@mrmlnc/readdir-enhanced", "2.2.1"],
      ]),
    }],
  ])],
  ["call-me-maybe", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-call-me-maybe-1.0.1-26d208ea89e37b5cbde60250a15f031c16a4d66b/node_modules/call-me-maybe/"),
      packageDependencies: new Map([
        ["call-me-maybe", "1.0.1"],
      ]),
    }],
  ])],
  ["glob-to-regexp", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-glob-to-regexp-0.3.0-8c5a1494d2066c570cc3bfe4496175acc4d502ab/node_modules/glob-to-regexp/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.3.0"],
      ]),
    }],
  ])],
  ["@nodelib/fs.stat", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@nodelib-fs-stat-1.1.3-2b5a3ab3f918cca48a8c754c08168e3f03eba61b/node_modules/@nodelib/fs.stat/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "1.1.3"],
      ]),
    }],
  ])],
  ["merge2", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-merge2-1.2.3-7ee99dbd69bb6481689253f018488a1b902b0ed5/node_modules/merge2/"),
      packageDependencies: new Map([
        ["merge2", "1.2.3"],
      ]),
    }],
  ])],
  ["ignore", new Map([
    ["4.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "4.0.6"],
      ]),
    }],
    ["5.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ignore-5.0.5-c663c548d6ce186fb33616a8ccb5d46e56bdbbf9/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "5.0.5"],
      ]),
    }],
  ])],
  ["slash", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-slash-2.0.0-de552851a1759df3a8f206535442f5ec4ddeab44/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "2.0.0"],
      ]),
    }],
  ])],
  ["globjoin", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-globjoin-0.1.4-2f4494ac8919e3767c5cbb691e9f463324285d43/node_modules/globjoin/"),
      packageDependencies: new Map([
        ["globjoin", "0.1.4"],
      ]),
    }],
  ])],
  ["html-tags", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-html-tags-2.0.0-10b30a386085f43cede353cc8fa7cb0deeea668b/node_modules/html-tags/"),
      packageDependencies: new Map([
        ["html-tags", "2.0.0"],
      ]),
    }],
  ])],
  ["import-lazy", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-import-lazy-3.1.0-891279202c8a2280fdbd6674dbd8da1a1dfc67cc/node_modules/import-lazy/"),
      packageDependencies: new Map([
        ["import-lazy", "3.1.0"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["known-css-properties", new Map([
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-known-css-properties-0.11.0-0da784f115ea77c76b81536d7052e90ee6c86a8a/node_modules/known-css-properties/"),
      packageDependencies: new Map([
        ["known-css-properties", "0.11.0"],
      ]),
    }],
  ])],
  ["leven", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-leven-2.1.0-c2e7a9f772094dee9d34202ae8acce4687875580/node_modules/leven/"),
      packageDependencies: new Map([
        ["leven", "2.1.0"],
      ]),
    }],
  ])],
  ["log-symbols", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-log-symbols-2.2.0-5740e1c5d6f0dfda4ad9323b5332107ef6b4c40a/node_modules/log-symbols/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["log-symbols", "2.2.0"],
      ]),
    }],
  ])],
  ["mathml-tag-names", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mathml-tag-names-2.1.0-490b70e062ee24636536e3d9481e333733d00f2c/node_modules/mathml-tag-names/"),
      packageDependencies: new Map([
        ["mathml-tag-names", "2.1.0"],
      ]),
    }],
  ])],
  ["meow", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-meow-5.0.0-dfc73d63a9afc714a5e371760eb5c88b91078aa4/node_modules/meow/"),
      packageDependencies: new Map([
        ["camelcase-keys", "4.2.0"],
        ["decamelize-keys", "1.1.0"],
        ["loud-rejection", "1.6.0"],
        ["minimist-options", "3.0.2"],
        ["normalize-package-data", "2.4.0"],
        ["read-pkg-up", "3.0.0"],
        ["redent", "2.0.0"],
        ["trim-newlines", "2.0.0"],
        ["yargs-parser", "10.1.0"],
        ["meow", "5.0.0"],
      ]),
    }],
  ])],
  ["camelcase-keys", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-camelcase-keys-4.2.0-a2aa5fb1af688758259c32c141426d78923b9b77/node_modules/camelcase-keys/"),
      packageDependencies: new Map([
        ["camelcase", "4.1.0"],
        ["map-obj", "2.0.0"],
        ["quick-lru", "1.1.0"],
        ["camelcase-keys", "4.2.0"],
      ]),
    }],
  ])],
  ["map-obj", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-map-obj-2.0.0-a65cd29087a92598b8791257a523e021222ac1f9/node_modules/map-obj/"),
      packageDependencies: new Map([
        ["map-obj", "2.0.0"],
      ]),
    }],
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-map-obj-1.0.1-d933ceb9205d82bdcf4886f6742bdc2b4dea146d/node_modules/map-obj/"),
      packageDependencies: new Map([
        ["map-obj", "1.0.1"],
      ]),
    }],
  ])],
  ["quick-lru", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-quick-lru-1.1.0-4360b17c61136ad38078397ff11416e186dcfbb8/node_modules/quick-lru/"),
      packageDependencies: new Map([
        ["quick-lru", "1.1.0"],
      ]),
    }],
  ])],
  ["decamelize-keys", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-decamelize-keys-1.1.0-d171a87933252807eb3cb61dc1c1445d078df2d9/node_modules/decamelize-keys/"),
      packageDependencies: new Map([
        ["decamelize", "1.2.0"],
        ["map-obj", "1.0.1"],
        ["decamelize-keys", "1.1.0"],
      ]),
    }],
  ])],
  ["loud-rejection", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-loud-rejection-1.6.0-5b46f80147edee578870f086d04821cf998e551f/node_modules/loud-rejection/"),
      packageDependencies: new Map([
        ["currently-unhandled", "0.4.1"],
        ["signal-exit", "3.0.2"],
        ["loud-rejection", "1.6.0"],
      ]),
    }],
  ])],
  ["currently-unhandled", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-currently-unhandled-0.4.1-988df33feab191ef799a61369dd76c17adf957ea/node_modules/currently-unhandled/"),
      packageDependencies: new Map([
        ["array-find-index", "1.0.2"],
        ["currently-unhandled", "0.4.1"],
      ]),
    }],
  ])],
  ["array-find-index", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-array-find-index-1.0.2-df010aa1287e164bbda6f9723b0a96a1ec4187a1/node_modules/array-find-index/"),
      packageDependencies: new Map([
        ["array-find-index", "1.0.2"],
      ]),
    }],
  ])],
  ["minimist-options", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-minimist-options-3.0.2-fba4c8191339e13ecf4d61beb03f070103f3d954/node_modules/minimist-options/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
        ["is-plain-obj", "1.1.0"],
        ["minimist-options", "3.0.2"],
      ]),
    }],
  ])],
  ["arrify", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/"),
      packageDependencies: new Map([
        ["arrify", "1.0.1"],
      ]),
    }],
  ])],
  ["is-plain-obj", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-plain-obj-1.1.0-71a50c8429dfca773c92a390a4a03b39fcd51d3e/node_modules/is-plain-obj/"),
      packageDependencies: new Map([
        ["is-plain-obj", "1.1.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "2.0.0"],
        ["path-exists", "3.0.0"],
        ["locate-path", "2.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "1.3.0"],
        ["p-locate", "2.0.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
        ["p-limit", "1.3.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
      ]),
    }],
  ])],
  ["redent", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-redent-2.0.0-c1b2007b42d57eb1389079b3c8333639d5e1ccaa/node_modules/redent/"),
      packageDependencies: new Map([
        ["indent-string", "3.2.0"],
        ["strip-indent", "2.0.0"],
        ["redent", "2.0.0"],
      ]),
    }],
  ])],
  ["indent-string", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-indent-string-3.2.0-4a5fd6d27cc332f37e5419a504dbb837105c9289/node_modules/indent-string/"),
      packageDependencies: new Map([
        ["indent-string", "3.2.0"],
      ]),
    }],
  ])],
  ["strip-indent", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-strip-indent-2.0.0-5ef8db295d01e6ed6cbf7aab96998d7822527b68/node_modules/strip-indent/"),
      packageDependencies: new Map([
        ["strip-indent", "2.0.0"],
      ]),
    }],
  ])],
  ["trim-newlines", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-trim-newlines-2.0.0-b403d0b91be50c331dfc4b82eeceb22c3de16d20/node_modules/trim-newlines/"),
      packageDependencies: new Map([
        ["trim-newlines", "2.0.0"],
      ]),
    }],
  ])],
  ["normalize-selector", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-normalize-selector-0.2.0-d0b145eb691189c63a78d201dc4fdb1293ef0c03/node_modules/normalize-selector/"),
      packageDependencies: new Map([
        ["normalize-selector", "0.2.0"],
      ]),
    }],
  ])],
  ["postcss-html", new Map([
    ["0.36.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-html-0.36.0-b40913f94eaacc2453fd30a1327ad6ee1f88b204/node_modules/postcss-html/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-syntax", "0.36.2"],
        ["htmlparser2", "3.10.0"],
        ["postcss-html", "0.36.0"],
      ]),
    }],
  ])],
  ["htmlparser2", new Map([
    ["3.10.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-htmlparser2-3.10.0-5f5e422dcf6119c0d983ed36260ce9ded0bee464/node_modules/htmlparser2/"),
      packageDependencies: new Map([
        ["domelementtype", "1.3.1"],
        ["domhandler", "2.4.2"],
        ["domutils", "1.7.0"],
        ["entities", "1.1.2"],
        ["inherits", "2.0.3"],
        ["readable-stream", "3.1.1"],
        ["htmlparser2", "3.10.0"],
      ]),
    }],
  ])],
  ["domelementtype", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-domelementtype-1.3.1-d048c44b37b0d10a7f2a3d5fee3f4333d790481f/node_modules/domelementtype/"),
      packageDependencies: new Map([
        ["domelementtype", "1.3.1"],
      ]),
    }],
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-domelementtype-1.1.3-bd28773e2642881aec51544924299c5cd822185b/node_modules/domelementtype/"),
      packageDependencies: new Map([
        ["domelementtype", "1.1.3"],
      ]),
    }],
  ])],
  ["domhandler", new Map([
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-domhandler-2.4.2-8805097e933d65e85546f726d60f5eb88b44f803/node_modules/domhandler/"),
      packageDependencies: new Map([
        ["domelementtype", "1.3.1"],
        ["domhandler", "2.4.2"],
      ]),
    }],
  ])],
  ["domutils", new Map([
    ["1.7.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-domutils-1.7.0-56ea341e834e06e6748af7a1cb25da67ea9f8c2a/node_modules/domutils/"),
      packageDependencies: new Map([
        ["dom-serializer", "0.1.0"],
        ["domelementtype", "1.3.1"],
        ["domutils", "1.7.0"],
      ]),
    }],
  ])],
  ["dom-serializer", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-dom-serializer-0.1.0-073c697546ce0780ce23be4a28e293e40bc30c82/node_modules/dom-serializer/"),
      packageDependencies: new Map([
        ["domelementtype", "1.1.3"],
        ["entities", "1.1.2"],
        ["dom-serializer", "0.1.0"],
      ]),
    }],
  ])],
  ["entities", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-entities-1.1.2-bdfa735299664dfafd34529ed4f8522a275fea56/node_modules/entities/"),
      packageDependencies: new Map([
        ["entities", "1.1.2"],
      ]),
    }],
  ])],
  ["postcss-jsx", new Map([
    ["0.36.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-jsx-0.36.0-b7685ed3d070a175ef0aa48f83d9015bd772c82d/node_modules/postcss-jsx/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-syntax", "0.36.2"],
        ["@babel/core", "7.2.2"],
        ["postcss-jsx", "0.36.0"],
      ]),
    }],
  ])],
  ["@babel/core", new Map([
    ["7.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-core-7.2.2-07adba6dde27bb5ad8d8672f15fde3e08184a687/node_modules/@babel/core/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.0.0"],
        ["@babel/generator", "7.3.0"],
        ["@babel/helpers", "7.3.1"],
        ["@babel/parser", "7.3.1"],
        ["@babel/template", "7.2.2"],
        ["@babel/traverse", "7.2.3"],
        ["@babel/types", "7.3.0"],
        ["convert-source-map", "1.6.0"],
        ["debug", "4.1.1"],
        ["json5", "2.1.0"],
        ["lodash", "4.17.11"],
        ["resolve", "1.10.0"],
        ["semver", "5.6.0"],
        ["source-map", "0.5.7"],
        ["@babel/core", "7.2.2"],
      ]),
    }],
  ])],
  ["@babel/code-frame", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-code-frame-7.0.0-06e2ab19bdb535385559aabb5ba59729482800f8/node_modules/@babel/code-frame/"),
      packageDependencies: new Map([
        ["@babel/highlight", "7.0.0"],
        ["@babel/code-frame", "7.0.0"],
      ]),
    }],
  ])],
  ["@babel/highlight", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-highlight-7.0.0-f710c38c8d458e6dd9a201afb637fcb781ce99e4/node_modules/@babel/highlight/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["esutils", "2.0.2"],
        ["js-tokens", "4.0.0"],
        ["@babel/highlight", "7.0.0"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-esutils-2.0.2-0abf4f1caa5bcb1f7a9d8acc6dea4faaa04bac9b/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.2"],
      ]),
    }],
  ])],
  ["js-tokens", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/"),
      packageDependencies: new Map([
        ["js-tokens", "4.0.0"],
      ]),
    }],
  ])],
  ["@babel/generator", new Map([
    ["7.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-generator-7.3.0-f663838cd7b542366de3aa608a657b8ccb2a99eb/node_modules/@babel/generator/"),
      packageDependencies: new Map([
        ["@babel/types", "7.3.0"],
        ["jsesc", "2.5.2"],
        ["lodash", "4.17.11"],
        ["source-map", "0.5.7"],
        ["trim-right", "1.0.1"],
        ["@babel/generator", "7.3.0"],
      ]),
    }],
  ])],
  ["@babel/types", new Map([
    ["7.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-types-7.3.0-61dc0b336a93badc02bf5f69c4cd8e1353f2ffc0/node_modules/@babel/types/"),
      packageDependencies: new Map([
        ["esutils", "2.0.2"],
        ["lodash", "4.17.11"],
        ["to-fast-properties", "2.0.0"],
        ["@babel/types", "7.3.0"],
      ]),
    }],
  ])],
  ["to-fast-properties", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-to-fast-properties-2.0.0-dc5e698cbd079265bc73e0377681a4e4e83f616e/node_modules/to-fast-properties/"),
      packageDependencies: new Map([
        ["to-fast-properties", "2.0.0"],
      ]),
    }],
  ])],
  ["jsesc", new Map([
    ["2.5.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-jsesc-2.5.2-80564d2e483dacf6e8ef209650a67df3f0c283a4/node_modules/jsesc/"),
      packageDependencies: new Map([
        ["jsesc", "2.5.2"],
      ]),
    }],
  ])],
  ["trim-right", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-trim-right-1.0.1-cb2e1203067e0c8de1f614094b9fe45704ea6003/node_modules/trim-right/"),
      packageDependencies: new Map([
        ["trim-right", "1.0.1"],
      ]),
    }],
  ])],
  ["@babel/helpers", new Map([
    ["7.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-helpers-7.3.1-949eec9ea4b45d3210feb7dc1c22db664c9e44b9/node_modules/@babel/helpers/"),
      packageDependencies: new Map([
        ["@babel/template", "7.2.2"],
        ["@babel/traverse", "7.2.3"],
        ["@babel/types", "7.3.0"],
        ["@babel/helpers", "7.3.1"],
      ]),
    }],
  ])],
  ["@babel/template", new Map([
    ["7.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-template-7.2.2-005b3fdf0ed96e88041330379e0da9a708eb2907/node_modules/@babel/template/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.0.0"],
        ["@babel/parser", "7.3.1"],
        ["@babel/types", "7.3.0"],
        ["@babel/template", "7.2.2"],
      ]),
    }],
  ])],
  ["@babel/parser", new Map([
    ["7.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-parser-7.3.1-8f4ffd45f779e6132780835ffa7a215fa0b2d181/node_modules/@babel/parser/"),
      packageDependencies: new Map([
        ["@babel/parser", "7.3.1"],
      ]),
    }],
  ])],
  ["@babel/traverse", new Map([
    ["7.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-traverse-7.2.3-7ff50cefa9c7c0bd2d81231fdac122f3957748d8/node_modules/@babel/traverse/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.0.0"],
        ["@babel/generator", "7.3.0"],
        ["@babel/helper-function-name", "7.1.0"],
        ["@babel/helper-split-export-declaration", "7.0.0"],
        ["@babel/parser", "7.3.1"],
        ["@babel/types", "7.3.0"],
        ["debug", "4.1.1"],
        ["globals", "11.10.0"],
        ["lodash", "4.17.11"],
        ["@babel/traverse", "7.2.3"],
      ]),
    }],
  ])],
  ["@babel/helper-function-name", new Map([
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-helper-function-name-7.1.0-a0ceb01685f73355d4360c1247f582bfafc8ff53/node_modules/@babel/helper-function-name/"),
      packageDependencies: new Map([
        ["@babel/helper-get-function-arity", "7.0.0"],
        ["@babel/template", "7.2.2"],
        ["@babel/types", "7.3.0"],
        ["@babel/helper-function-name", "7.1.0"],
      ]),
    }],
  ])],
  ["@babel/helper-get-function-arity", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-helper-get-function-arity-7.0.0-83572d4320e2a4657263734113c42868b64e49c3/node_modules/@babel/helper-get-function-arity/"),
      packageDependencies: new Map([
        ["@babel/types", "7.3.0"],
        ["@babel/helper-get-function-arity", "7.0.0"],
      ]),
    }],
  ])],
  ["@babel/helper-split-export-declaration", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@babel-helper-split-export-declaration-7.0.0-3aae285c0311c2ab095d997b8c9a94cad547d813/node_modules/@babel/helper-split-export-declaration/"),
      packageDependencies: new Map([
        ["@babel/types", "7.3.0"],
        ["@babel/helper-split-export-declaration", "7.0.0"],
      ]),
    }],
  ])],
  ["globals", new Map([
    ["11.10.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-globals-11.10.0-1e09776dffda5e01816b3bb4077c8b59c24eaa50/node_modules/globals/"),
      packageDependencies: new Map([
        ["globals", "11.10.0"],
      ]),
    }],
  ])],
  ["convert-source-map", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-convert-source-map-1.6.0-51b537a8c43e0f04dec1993bffcdd504e758ac20/node_modules/convert-source-map/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["convert-source-map", "1.6.0"],
      ]),
    }],
  ])],
  ["json5", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-json5-2.1.0-e7a0c62c48285c628d20a10b85c89bb807c32850/node_modules/json5/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
        ["json5", "2.1.0"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-resolve-1.10.0-3bdaaeaf45cc07f375656dfd2e54ed0810b101ba/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.10.0"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["postcss-less", new Map([
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-less-3.1.2-fb67e7ba351dbdf69de3c52eebd1184c52bfaea6/node_modules/postcss-less/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-less", "3.1.2"],
      ]),
    }],
  ])],
  ["postcss-markdown", new Map([
    ["0.36.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-markdown-0.36.0-7f22849ae0e3db18820b7b0d5e7833f13a447560/node_modules/postcss-markdown/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-syntax", "0.36.2"],
        ["remark", "10.0.1"],
        ["unist-util-find-all-after", "1.0.2"],
        ["postcss-markdown", "0.36.0"],
      ]),
    }],
  ])],
  ["remark", new Map([
    ["10.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-remark-10.0.1-3058076dc41781bf505d8978c291485fe47667df/node_modules/remark/"),
      packageDependencies: new Map([
        ["remark-parse", "6.0.3"],
        ["remark-stringify", "6.0.4"],
        ["unified", "7.1.0"],
        ["remark", "10.0.1"],
      ]),
    }],
  ])],
  ["remark-parse", new Map([
    ["6.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-remark-parse-6.0.3-c99131052809da482108413f87b0ee7f52180a3a/node_modules/remark-parse/"),
      packageDependencies: new Map([
        ["collapse-white-space", "1.0.4"],
        ["is-alphabetical", "1.0.2"],
        ["is-decimal", "1.0.2"],
        ["is-whitespace-character", "1.0.2"],
        ["is-word-character", "1.0.2"],
        ["markdown-escapes", "1.0.2"],
        ["parse-entities", "1.2.0"],
        ["repeat-string", "1.6.1"],
        ["state-toggle", "1.0.1"],
        ["trim", "0.0.1"],
        ["trim-trailing-lines", "1.1.1"],
        ["unherit", "1.1.1"],
        ["unist-util-remove-position", "1.1.2"],
        ["vfile-location", "2.0.4"],
        ["xtend", "4.0.1"],
        ["remark-parse", "6.0.3"],
      ]),
    }],
  ])],
  ["collapse-white-space", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-collapse-white-space-1.0.4-ce05cf49e54c3277ae573036a26851ba430a0091/node_modules/collapse-white-space/"),
      packageDependencies: new Map([
        ["collapse-white-space", "1.0.4"],
      ]),
    }],
  ])],
  ["is-alphabetical", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-alphabetical-1.0.2-1fa6e49213cb7885b75d15862fb3f3d96c884f41/node_modules/is-alphabetical/"),
      packageDependencies: new Map([
        ["is-alphabetical", "1.0.2"],
      ]),
    }],
  ])],
  ["is-decimal", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-decimal-1.0.2-894662d6a8709d307f3a276ca4339c8fa5dff0ff/node_modules/is-decimal/"),
      packageDependencies: new Map([
        ["is-decimal", "1.0.2"],
      ]),
    }],
  ])],
  ["is-whitespace-character", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-whitespace-character-1.0.2-ede53b4c6f6fb3874533751ec9280d01928d03ed/node_modules/is-whitespace-character/"),
      packageDependencies: new Map([
        ["is-whitespace-character", "1.0.2"],
      ]),
    }],
  ])],
  ["is-word-character", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-word-character-1.0.2-46a5dac3f2a1840898b91e576cd40d493f3ae553/node_modules/is-word-character/"),
      packageDependencies: new Map([
        ["is-word-character", "1.0.2"],
      ]),
    }],
  ])],
  ["markdown-escapes", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-markdown-escapes-1.0.2-e639cbde7b99c841c0bacc8a07982873b46d2122/node_modules/markdown-escapes/"),
      packageDependencies: new Map([
        ["markdown-escapes", "1.0.2"],
      ]),
    }],
  ])],
  ["parse-entities", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-parse-entities-1.2.0-9deac087661b2e36814153cb78d7e54a4c5fd6f4/node_modules/parse-entities/"),
      packageDependencies: new Map([
        ["character-entities", "1.2.2"],
        ["character-entities-legacy", "1.1.2"],
        ["character-reference-invalid", "1.1.2"],
        ["is-alphanumerical", "1.0.2"],
        ["is-decimal", "1.0.2"],
        ["is-hexadecimal", "1.0.2"],
        ["parse-entities", "1.2.0"],
      ]),
    }],
  ])],
  ["character-entities", new Map([
    ["1.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-character-entities-1.2.2-58c8f371c0774ef0ba9b2aca5f00d8f100e6e363/node_modules/character-entities/"),
      packageDependencies: new Map([
        ["character-entities", "1.2.2"],
      ]),
    }],
  ])],
  ["character-entities-legacy", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-character-entities-legacy-1.1.2-7c6defb81648498222c9855309953d05f4d63a9c/node_modules/character-entities-legacy/"),
      packageDependencies: new Map([
        ["character-entities-legacy", "1.1.2"],
      ]),
    }],
  ])],
  ["character-reference-invalid", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-character-reference-invalid-1.1.2-21e421ad3d84055952dab4a43a04e73cd425d3ed/node_modules/character-reference-invalid/"),
      packageDependencies: new Map([
        ["character-reference-invalid", "1.1.2"],
      ]),
    }],
  ])],
  ["is-alphanumerical", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-alphanumerical-1.0.2-1138e9ae5040158dc6ff76b820acd6b7a181fd40/node_modules/is-alphanumerical/"),
      packageDependencies: new Map([
        ["is-alphabetical", "1.0.2"],
        ["is-decimal", "1.0.2"],
        ["is-alphanumerical", "1.0.2"],
      ]),
    }],
  ])],
  ["is-hexadecimal", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-hexadecimal-1.0.2-b6e710d7d07bb66b98cb8cece5c9b4921deeb835/node_modules/is-hexadecimal/"),
      packageDependencies: new Map([
        ["is-hexadecimal", "1.0.2"],
      ]),
    }],
  ])],
  ["state-toggle", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-state-toggle-1.0.1-c3cb0974f40a6a0f8e905b96789eb41afa1cde3a/node_modules/state-toggle/"),
      packageDependencies: new Map([
        ["state-toggle", "1.0.1"],
      ]),
    }],
  ])],
  ["trim", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-trim-0.0.1-5858547f6b290757ee95cccc666fb50084c460dd/node_modules/trim/"),
      packageDependencies: new Map([
        ["trim", "0.0.1"],
      ]),
    }],
  ])],
  ["trim-trailing-lines", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-trim-trailing-lines-1.1.1-e0ec0810fd3c3f1730516b45f49083caaf2774d9/node_modules/trim-trailing-lines/"),
      packageDependencies: new Map([
        ["trim-trailing-lines", "1.1.1"],
      ]),
    }],
  ])],
  ["unherit", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unherit-1.1.1-132748da3e88eab767e08fabfbb89c5e9d28628c/node_modules/unherit/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
        ["xtend", "4.0.1"],
        ["unherit", "1.1.1"],
      ]),
    }],
  ])],
  ["xtend", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-xtend-4.0.1-a5c6d532be656e23db820efb943a1f04998d63af/node_modules/xtend/"),
      packageDependencies: new Map([
        ["xtend", "4.0.1"],
      ]),
    }],
  ])],
  ["unist-util-remove-position", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-remove-position-1.1.2-86b5dad104d0bbfbeb1db5f5c92f3570575c12cb/node_modules/unist-util-remove-position/"),
      packageDependencies: new Map([
        ["unist-util-visit", "1.4.0"],
        ["unist-util-remove-position", "1.1.2"],
      ]),
    }],
  ])],
  ["unist-util-visit", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-visit-1.4.0-1cb763647186dc26f5e1df5db6bd1e48b3cc2fb1/node_modules/unist-util-visit/"),
      packageDependencies: new Map([
        ["unist-util-visit-parents", "2.0.1"],
        ["unist-util-visit", "1.4.0"],
      ]),
    }],
  ])],
  ["unist-util-visit-parents", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-visit-parents-2.0.1-63fffc8929027bee04bfef7d2cce474f71cb6217/node_modules/unist-util-visit-parents/"),
      packageDependencies: new Map([
        ["unist-util-is", "2.1.2"],
        ["unist-util-visit-parents", "2.0.1"],
      ]),
    }],
  ])],
  ["unist-util-is", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-is-2.1.2-1193fa8f2bfbbb82150633f3a8d2eb9a1c1d55db/node_modules/unist-util-is/"),
      packageDependencies: new Map([
        ["unist-util-is", "2.1.2"],
      ]),
    }],
  ])],
  ["vfile-location", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-vfile-location-2.0.4-2a5e7297dd0d9e2da4381464d04acc6b834d3e55/node_modules/vfile-location/"),
      packageDependencies: new Map([
        ["vfile-location", "2.0.4"],
      ]),
    }],
  ])],
  ["remark-stringify", new Map([
    ["6.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-remark-stringify-6.0.4-16ac229d4d1593249018663c7bddf28aafc4e088/node_modules/remark-stringify/"),
      packageDependencies: new Map([
        ["ccount", "1.0.3"],
        ["is-alphanumeric", "1.0.0"],
        ["is-decimal", "1.0.2"],
        ["is-whitespace-character", "1.0.2"],
        ["longest-streak", "2.0.2"],
        ["markdown-escapes", "1.0.2"],
        ["markdown-table", "1.1.2"],
        ["mdast-util-compact", "1.0.2"],
        ["parse-entities", "1.2.0"],
        ["repeat-string", "1.6.1"],
        ["state-toggle", "1.0.1"],
        ["stringify-entities", "1.3.2"],
        ["unherit", "1.1.1"],
        ["xtend", "4.0.1"],
        ["remark-stringify", "6.0.4"],
      ]),
    }],
  ])],
  ["ccount", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ccount-1.0.3-f1cec43f332e2ea5a569fd46f9f5bde4e6102aff/node_modules/ccount/"),
      packageDependencies: new Map([
        ["ccount", "1.0.3"],
      ]),
    }],
  ])],
  ["is-alphanumeric", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-alphanumeric-1.0.0-4a9cef71daf4c001c1d81d63d140cf53fd6889f4/node_modules/is-alphanumeric/"),
      packageDependencies: new Map([
        ["is-alphanumeric", "1.0.0"],
      ]),
    }],
  ])],
  ["longest-streak", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-longest-streak-2.0.2-2421b6ba939a443bb9ffebf596585a50b4c38e2e/node_modules/longest-streak/"),
      packageDependencies: new Map([
        ["longest-streak", "2.0.2"],
      ]),
    }],
  ])],
  ["markdown-table", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-markdown-table-1.1.2-c78db948fa879903a41bce522e3b96f801c63786/node_modules/markdown-table/"),
      packageDependencies: new Map([
        ["markdown-table", "1.1.2"],
      ]),
    }],
  ])],
  ["mdast-util-compact", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-mdast-util-compact-1.0.2-c12ebe16fffc84573d3e19767726de226e95f649/node_modules/mdast-util-compact/"),
      packageDependencies: new Map([
        ["unist-util-visit", "1.4.0"],
        ["mdast-util-compact", "1.0.2"],
      ]),
    }],
  ])],
  ["stringify-entities", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-stringify-entities-1.3.2-a98417e5471fd227b3e45d3db1861c11caf668f7/node_modules/stringify-entities/"),
      packageDependencies: new Map([
        ["character-entities-html4", "1.1.2"],
        ["character-entities-legacy", "1.1.2"],
        ["is-alphanumerical", "1.0.2"],
        ["is-hexadecimal", "1.0.2"],
        ["stringify-entities", "1.3.2"],
      ]),
    }],
  ])],
  ["character-entities-html4", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-character-entities-html4-1.1.2-c44fdde3ce66b52e8d321d6c1bf46101f0150610/node_modules/character-entities-html4/"),
      packageDependencies: new Map([
        ["character-entities-html4", "1.1.2"],
      ]),
    }],
  ])],
  ["unified", new Map([
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unified-7.1.0-5032f1c1ee3364bd09da12e27fdd4a7553c7be13/node_modules/unified/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.2"],
        ["@types/vfile", "3.0.2"],
        ["bail", "1.0.3"],
        ["extend", "3.0.2"],
        ["is-plain-obj", "1.1.0"],
        ["trough", "1.0.3"],
        ["vfile", "3.0.1"],
        ["x-is-string", "0.1.0"],
        ["unified", "7.1.0"],
      ]),
    }],
  ])],
  ["@types/unist", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@types-unist-2.0.2-5dc0a7f76809b7518c0df58689cd16a19bd751c6/node_modules/@types/unist/"),
      packageDependencies: new Map([
        ["@types/unist", "2.0.2"],
      ]),
    }],
  ])],
  ["@types/vfile", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@types-vfile-3.0.2-19c18cd232df11ce6fa6ad80259bc86c366b09b9/node_modules/@types/vfile/"),
      packageDependencies: new Map([
        ["@types/node", "10.12.18"],
        ["@types/unist", "2.0.2"],
        ["@types/vfile-message", "1.0.1"],
        ["@types/vfile", "3.0.2"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["10.12.18", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@types-node-10.12.18-1d3ca764718915584fcd9f6344621b7672665c67/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["@types/node", "10.12.18"],
      ]),
    }],
  ])],
  ["@types/vfile-message", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-@types-vfile-message-1.0.1-e1e9895cc6b36c462d4244e64e6d0b6eaf65355a/node_modules/@types/vfile-message/"),
      packageDependencies: new Map([
        ["@types/node", "10.12.18"],
        ["@types/unist", "2.0.2"],
        ["@types/vfile-message", "1.0.1"],
      ]),
    }],
  ])],
  ["bail", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-bail-1.0.3-63cfb9ddbac829b02a3128cd53224be78e6c21a3/node_modules/bail/"),
      packageDependencies: new Map([
        ["bail", "1.0.3"],
      ]),
    }],
  ])],
  ["extend", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/"),
      packageDependencies: new Map([
        ["extend", "3.0.2"],
      ]),
    }],
  ])],
  ["trough", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-trough-1.0.3-e29bd1614c6458d44869fc28b255ab7857ef7c24/node_modules/trough/"),
      packageDependencies: new Map([
        ["trough", "1.0.3"],
      ]),
    }],
  ])],
  ["vfile", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-vfile-3.0.1-47331d2abe3282424f4a4bb6acd20a44c4121803/node_modules/vfile/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.3"],
        ["replace-ext", "1.0.0"],
        ["unist-util-stringify-position", "1.1.2"],
        ["vfile-message", "1.1.1"],
        ["vfile", "3.0.1"],
      ]),
    }],
  ])],
  ["replace-ext", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-replace-ext-1.0.0-de63128373fcbf7c3ccfa4de5a480c45a67958eb/node_modules/replace-ext/"),
      packageDependencies: new Map([
        ["replace-ext", "1.0.0"],
      ]),
    }],
  ])],
  ["unist-util-stringify-position", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-stringify-position-1.1.2-3f37fcf351279dcbca7480ab5889bb8a832ee1c6/node_modules/unist-util-stringify-position/"),
      packageDependencies: new Map([
        ["unist-util-stringify-position", "1.1.2"],
      ]),
    }],
  ])],
  ["vfile-message", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-vfile-message-1.1.1-5833ae078a1dfa2d96e9647886cd32993ab313e1/node_modules/vfile-message/"),
      packageDependencies: new Map([
        ["unist-util-stringify-position", "1.1.2"],
        ["vfile-message", "1.1.1"],
      ]),
    }],
  ])],
  ["x-is-string", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-x-is-string-0.1.0-474b50865af3a49a9c4657f05acd145458f77d82/node_modules/x-is-string/"),
      packageDependencies: new Map([
        ["x-is-string", "0.1.0"],
      ]),
    }],
  ])],
  ["unist-util-find-all-after", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-unist-util-find-all-after-1.0.2-9be49cfbae5ca1566b27536670a92836bf2f8d6d/node_modules/unist-util-find-all-after/"),
      packageDependencies: new Map([
        ["unist-util-is", "2.1.2"],
        ["unist-util-find-all-after", "1.0.2"],
      ]),
    }],
  ])],
  ["postcss-media-query-parser", new Map([
    ["0.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-media-query-parser-0.2.3-27b39c6f4d94f81b1a73b8f76351c609e5cef244/node_modules/postcss-media-query-parser/"),
      packageDependencies: new Map([
        ["postcss-media-query-parser", "0.2.3"],
      ]),
    }],
  ])],
  ["postcss-reporter", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-reporter-6.0.1-7c055120060a97c8837b4e48215661aafb74245f/node_modules/postcss-reporter/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["lodash", "4.17.11"],
        ["log-symbols", "2.2.0"],
        ["postcss", "7.0.14"],
        ["postcss-reporter", "6.0.1"],
      ]),
    }],
  ])],
  ["postcss-resolve-nested-selector", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-resolve-nested-selector-0.1.1-29ccbc7c37dedfac304e9fff0bf1596b3f6a0e4e/node_modules/postcss-resolve-nested-selector/"),
      packageDependencies: new Map([
        ["postcss-resolve-nested-selector", "0.1.1"],
      ]),
    }],
  ])],
  ["postcss-safe-parser", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-safe-parser-4.0.1-8756d9e4c36fdce2c72b091bbc8ca176ab1fcdea/node_modules/postcss-safe-parser/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-safe-parser", "4.0.1"],
      ]),
    }],
  ])],
  ["postcss-sass", new Map([
    ["0.3.5", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-sass-0.3.5-6d3e39f101a53d2efa091f953493116d32beb68c/node_modules/postcss-sass/"),
      packageDependencies: new Map([
        ["gonzales-pe", "4.2.3"],
        ["postcss", "7.0.14"],
        ["postcss-sass", "0.3.5"],
      ]),
    }],
  ])],
  ["gonzales-pe", new Map([
    ["4.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-gonzales-pe-4.2.3-41091703625433285e0aee3aa47829fc1fbeb6f2/node_modules/gonzales-pe/"),
      packageDependencies: new Map([
        ["minimist", "1.1.3"],
        ["gonzales-pe", "4.2.3"],
      ]),
    }],
  ])],
  ["postcss-scss", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-scss-2.0.0-248b0a28af77ea7b32b1011aba0f738bda27dea1/node_modules/postcss-scss/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-scss", "2.0.0"],
      ]),
    }],
  ])],
  ["postcss-selector-parser", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-selector-parser-3.1.1-4f875f4afb0c96573d5cf4d74011aee250a7e865/node_modules/postcss-selector-parser/"),
      packageDependencies: new Map([
        ["dot-prop", "4.2.0"],
        ["indexes-of", "1.0.1"],
        ["uniq", "1.0.1"],
        ["postcss-selector-parser", "3.1.1"],
      ]),
    }],
  ])],
  ["dot-prop", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-dot-prop-4.2.0-1f19e0c2e1aa0e32797c49799f2837ac6af69c57/node_modules/dot-prop/"),
      packageDependencies: new Map([
        ["is-obj", "1.0.1"],
        ["dot-prop", "4.2.0"],
      ]),
    }],
  ])],
  ["is-obj", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-is-obj-1.0.1-3e4729ac1f5fde025cd7d83a896dab9f4f67db0f/node_modules/is-obj/"),
      packageDependencies: new Map([
        ["is-obj", "1.0.1"],
      ]),
    }],
  ])],
  ["indexes-of", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-indexes-of-1.0.1-f30f716c8e2bd346c7b67d3df3915566a7c05607/node_modules/indexes-of/"),
      packageDependencies: new Map([
        ["indexes-of", "1.0.1"],
      ]),
    }],
  ])],
  ["uniq", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-uniq-1.0.1-b31c5ae8254844a3a8281541ce2b04b865a734ff/node_modules/uniq/"),
      packageDependencies: new Map([
        ["uniq", "1.0.1"],
      ]),
    }],
  ])],
  ["postcss-syntax", new Map([
    ["0.36.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-postcss-syntax-0.36.2-f08578c7d95834574e5593a82dfbfa8afae3b51c/node_modules/postcss-syntax/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["postcss-syntax", "0.36.2"],
      ]),
    }],
  ])],
  ["specificity", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-specificity-0.4.1-aab5e645012db08ba182e151165738d00887b019/node_modules/specificity/"),
      packageDependencies: new Map([
        ["specificity", "0.4.1"],
      ]),
    }],
  ])],
  ["emoji-regex", new Map([
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
      ]),
    }],
  ])],
  ["style-search", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-style-search-0.1.0-7958c793e47e32e07d2b5cafe5c0bf8e12e77902/node_modules/style-search/"),
      packageDependencies: new Map([
        ["style-search", "0.1.0"],
      ]),
    }],
  ])],
  ["sugarss", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-sugarss-2.0.0-ddd76e0124b297d40bf3cca31c8b22ecb43bc61d/node_modules/sugarss/"),
      packageDependencies: new Map([
        ["postcss", "7.0.14"],
        ["sugarss", "2.0.0"],
      ]),
    }],
  ])],
  ["svg-tags", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-svg-tags-1.0.0-58f71cee3bd519b59d4b2a843b6c7de64ac04764/node_modules/svg-tags/"),
      packageDependencies: new Map([
        ["svg-tags", "1.0.0"],
      ]),
    }],
  ])],
  ["table", new Map([
    ["5.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-table-5.2.2-61d474c9e4d8f4f7062c98c7504acb3c08aa738f/node_modules/table/"),
      packageDependencies: new Map([
        ["ajv", "6.7.0"],
        ["lodash", "4.17.11"],
        ["slice-ansi", "2.1.0"],
        ["string-width", "2.1.1"],
        ["table", "5.2.2"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["6.7.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-ajv-6.7.0-e3ce7bb372d6577bb1839f1dfdfcbf5ad2948d96/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "2.0.1"],
        ["fast-json-stable-stringify", "2.0.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.2.2"],
        ["ajv", "6.7.0"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fast-deep-equal-2.0.1-7b05218ddf9667bf7f370bf7fdb2cb15fdd0aa49/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "2.0.1"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-fast-json-stable-stringify-2.0.0-d5142c0caee6b1189f87d3a76111064f86c8bbf2/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.0.0"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
        ["uri-js", "4.2.2"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
      ]),
    }],
  ])],
  ["slice-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636/node_modules/slice-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["astral-regex", "1.0.0"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["slice-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["astral-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9/node_modules/astral-regex/"),
      packageDependencies: new Map([
        ["astral-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["stylelint-config-standard", new Map([
    ["18.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-stylelint-config-standard-18.2.0-6283149aba7f64f18731aef8f0abfb35cf619e06/node_modules/stylelint-config-standard/"),
      packageDependencies: new Map([
        ["stylelint", "9.10.1"],
        ["stylelint-config-recommended", "2.1.0"],
        ["stylelint-config-standard", "18.2.0"],
      ]),
    }],
  ])],
  ["stylelint-config-recommended", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Library/Caches/Yarn/v4/npm-stylelint-config-recommended-2.1.0-f526d5c771c6811186d9eaedbed02195fee30858/node_modules/stylelint-config-recommended/"),
      packageDependencies: new Map([
        ["stylelint", "9.10.1"],
        ["stylelint-config-recommended", "2.1.0"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["browser-sync", "2.26.3"],
        ["stylelint", "9.10.1"],
        ["stylelint-config-standard", "18.2.0"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../../Library/Caches/Yarn/v4/npm-browser-sync-2.26.3-1b59bd5935938a5b0fa73b3d78ef1050bd2bf912/node_modules/browser-sync/", {"name":"browser-sync","reference":"2.26.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-browser-sync-client-2.26.2-dd0070c80bdc6d9021e89f7837ee70ed0a8acf91/node_modules/browser-sync-client/", {"name":"browser-sync-client","reference":"2.26.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887/node_modules/etag/", {"name":"etag","reference":"1.8.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7/node_modules/fresh/", {"name":"fresh","reference":"0.5.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-mitt-1.1.3-528c506238a05dce11cd914a741ea2cc332da9b8/node_modules/mitt/", {"name":"mitt","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-rxjs-5.5.12-6fa61b8a77c3d793dbaf270bee2f43f652d741cc/node_modules/rxjs/", {"name":"rxjs","reference":"5.5.12"}],
  ["../../../Library/Caches/Yarn/v4/npm-symbol-observable-1.0.1-8340fc4702c3122df5d22288f88283f513d3fdd4/node_modules/symbol-observable/", {"name":"symbol-observable","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-browser-sync-ui-2.26.2-a1d8e107cfed5849d77e3bbd84ae5d566beb4ea0/node_modules/browser-sync-ui/", {"name":"browser-sync-ui","reference":"2.26.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-async-each-series-0.1.1-7617c1917401fd8ca4a28aadce3dbae98afeb432/node_modules/async-each-series/", {"name":"async-each-series","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-connect-history-api-fallback-1.6.0-8b32089359308d111115d81cad3fceab888f97bc/node_modules/connect-history-api-fallback/", {"name":"connect-history-api-fallback","reference":"1.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-immutable-3.8.2-c2439951455bb39913daf281376f1530e104adf3/node_modules/immutable/", {"name":"immutable","reference":"3.8.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-server-destroy-1.0.1-f13bf928e42b9c3e79383e61cc3998b5d14e6cdd/node_modules/server-destroy/", {"name":"server-destroy","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-client-2.2.0-84e73ee3c43d5020ccc1a258faeeb9aec2723af7/node_modules/socket.io-client/", {"name":"socket.io-client","reference":"2.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-client-2.1.1-dcb38103436ab4578ddb026638ae2f21b623671f/node_modules/socket.io-client/", {"name":"socket.io-client","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-backo2-1.0.2-31ab1ac8b129363463e35b3ebb69f4dfcfba7947/node_modules/backo2/", {"name":"backo2","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-base64-arraybuffer-0.1.5-73926771923b5a19747ad666aa5cd4bf9c6e9ce8/node_modules/base64-arraybuffer/", {"name":"base64-arraybuffer","reference":"0.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-component-bind-1.0.0-00c608ab7dcd93897c0009651b1d3a8e1e73bbd1/node_modules/component-bind/", {"name":"component-bind","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-component-emitter-1.2.1-137918d6d78283f7df7a6b7c5a63e140e69425e6/node_modules/component-emitter/", {"name":"component-emitter","reference":"1.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261/node_modules/debug/", {"name":"debug","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../../Library/Caches/Yarn/v4/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791/node_modules/debug/", {"name":"debug","reference":"4.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ms-2.1.1-30a5864eb3ebb0a66f2ebe6d727af06a09d86e0a/node_modules/ms/", {"name":"ms","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-engine-io-client-3.3.2-04e068798d75beda14375a264bb3d742d7bc33aa/node_modules/engine.io-client/", {"name":"engine.io-client","reference":"3.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-engine-io-client-3.2.1-6f54c0475de487158a1a7c77d10178708b6add36/node_modules/engine.io-client/", {"name":"engine.io-client","reference":"3.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-component-inherit-0.0.3-645fc4adf58b72b649d5cae65135619db26ff143/node_modules/component-inherit/", {"name":"component-inherit","reference":"0.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-engine-io-parser-2.1.3-757ab970fbf2dfb32c7b74b033216d5739ef79a6/node_modules/engine.io-parser/", {"name":"engine.io-parser","reference":"2.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-after-0.8.2-fedb394f9f0e02aa9768e702bda23b505fae7e1f/node_modules/after/", {"name":"after","reference":"0.8.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-arraybuffer-slice-0.0.7-3bbc4275dd584cc1b10809b89d4e8b63a69e7675/node_modules/arraybuffer.slice/", {"name":"arraybuffer.slice","reference":"0.0.7"}],
  ["../../../Library/Caches/Yarn/v4/npm-blob-0.0.5-d680eeef25f8cd91ad533f5b01eed48e64caf683/node_modules/blob/", {"name":"blob","reference":"0.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-binary2-1.0.3-7776ac627f3ea77250cfc332dab7ddf5e4f5d11d/node_modules/has-binary2/", {"name":"has-binary2","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-isarray-2.0.1-a37d94ed9cda2d59865c9f76fe596ee1f338741e/node_modules/isarray/", {"name":"isarray","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-cors-1.1.0-5e474793f7ea9843d1bb99c23eef49ff126fff39/node_modules/has-cors/", {"name":"has-cors","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-indexof-0.0.1-82dc336d232b9062179d05ab3293a66059fd435d/node_modules/indexof/", {"name":"indexof","reference":"0.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-parseqs-0.0.5-d5208a3738e46766e291ba2ea173684921a8b89d/node_modules/parseqs/", {"name":"parseqs","reference":"0.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-better-assert-1.0.2-40866b9e1b9e0b55b481894311e68faffaebc522/node_modules/better-assert/", {"name":"better-assert","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-callsite-1.0.0-280398e5d664bd74038b6f0905153e6e8af1bc20/node_modules/callsite/", {"name":"callsite","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-parseuri-0.0.5-80204a50d4dbb779bfdc6ebe2778d90e4bce320a/node_modules/parseuri/", {"name":"parseuri","reference":"0.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-ws-6.1.3-d2d2e5f0e3c700ef2de89080ebc0ac6e1bf3a72d/node_modules/ws/", {"name":"ws","reference":"6.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-ws-3.3.3-f1cf84fe2d5e901ebce94efaece785f187a228f2/node_modules/ws/", {"name":"ws","reference":"3.3.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-async-limiter-1.0.0-78faed8c3d074ab81f22b4e985d79e8738f720f8/node_modules/async-limiter/", {"name":"async-limiter","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-xmlhttprequest-ssl-1.5.5-c2876b06168aadc40e57d97e81191ac8f4398b3e/node_modules/xmlhttprequest-ssl/", {"name":"xmlhttprequest-ssl","reference":"1.5.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-yeast-0.1.2-008e06d8094320c372dbc2f8ed76a0ca6c8ac419/node_modules/yeast/", {"name":"yeast","reference":"0.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-component-0.0.3-f0c69aa50efc95b866c186f400a33769cb2f1291/node_modules/object-component/", {"name":"object-component","reference":"0.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-parser-3.3.0-2b52a96a509fdf31440ba40fed6094c7d4f1262f/node_modules/socket.io-parser/", {"name":"socket.io-parser","reference":"3.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-parser-3.2.0-e7c6228b6aa1f814e6148aea325b51aa9499e077/node_modules/socket.io-parser/", {"name":"socket.io-parser","reference":"3.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-to-array-0.1.4-17e6c11f73dd4f3d74cda7a4ff3238e9ad9bf890/node_modules/to-array/", {"name":"to-array","reference":"0.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-stream-throttle-0.1.3-add57c8d7cc73a81630d31cd55d3961cfafba9c3/node_modules/stream-throttle/", {"name":"stream-throttle","reference":"0.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-commander-2.19.0-f6198aa84e5b83c46054b94ddedbfed5ee9ff12a/node_modules/commander/", {"name":"commander","reference":"2.19.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-limiter-1.1.4-87c9c3972d389fdb0ba67a45aadbc5d2f8413bc1/node_modules/limiter/", {"name":"limiter","reference":"1.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-bs-recipes-1.3.4-0d2d4d48a718c8c044769fdc4f89592dc8b69585/node_modules/bs-recipes/", {"name":"bs-recipes","reference":"1.3.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-bs-snippet-injector-2.0.1-61b5393f11f52559ed120693100343b6edb04dd5/node_modules/bs-snippet-injector/", {"name":"bs-snippet-injector","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-chokidar-2.0.4-356ff4e2b0e8e43e322d18a372460bbcf3accd26/node_modules/chokidar/", {"name":"chokidar","reference":"2.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-anymatch-2.0.0-bcb24b4f37934d9aa7ac17b4adaf89e7c76ef2eb/node_modules/anymatch/", {"name":"anymatch","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-micromatch-3.1.10-70859bc95c9840952f359a068a3fc49f9ecfac23/node_modules/micromatch/", {"name":"micromatch","reference":"3.1.10"}],
  ["../../../Library/Caches/Yarn/v4/npm-micromatch-2.3.11-86677c97d1720b363431d04d0d15293bd38c1565/node_modules/micromatch/", {"name":"micromatch","reference":"2.3.11"}],
  ["../../../Library/Caches/Yarn/v4/npm-arr-diff-4.0.0-d6461074febfec71e7e15235761a329a5dc7c520/node_modules/arr-diff/", {"name":"arr-diff","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-arr-diff-2.0.0-8f3b827f955a8bd669697e4a4256ac3ceae356cf/node_modules/arr-diff/", {"name":"arr-diff","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-array-unique-0.3.2-a894b75d4bc4f6cd679ef3244a9fd8f46ae2d428/node_modules/array-unique/", {"name":"array-unique","reference":"0.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-array-unique-0.2.1-a1d97ccafcbc2625cc70fadceb36a50c58b01a53/node_modules/array-unique/", {"name":"array-unique","reference":"0.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-braces-2.3.2-5979fd3f14cd531565e5fa2df1abfff1dfaee729/node_modules/braces/", {"name":"braces","reference":"2.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-braces-1.8.5-ba77962e12dff969d6b76711e914b737857bf6a7/node_modules/braces/", {"name":"braces","reference":"1.8.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-arr-flatten-1.1.0-36048bbff4e7b47e136644316c99669ea5ae91f1/node_modules/arr-flatten/", {"name":"arr-flatten","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-extend-shallow-2.0.1-51af7d614ad9a9f610ea1bafbb989d6b1c56890f/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-extend-shallow-3.0.2-26a71aaf073b39fb2127172746131c2704028db8/node_modules/extend-shallow/", {"name":"extend-shallow","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-extendable-0.1.1-62b110e289a471418e3ec36a617d472e301dfc89/node_modules/is-extendable/", {"name":"is-extendable","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-extendable-1.0.1-a7470f9e426733d81bd81e1155264e3a3507cab4/node_modules/is-extendable/", {"name":"is-extendable","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-fill-range-4.0.0-d544811d428f98eb06a63dc402d2403c328c38f7/node_modules/fill-range/", {"name":"fill-range","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-fill-range-2.2.4-eb1e773abb056dcd8df2bfdf6af59b8b3a936565/node_modules/fill-range/", {"name":"fill-range","reference":"2.2.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-number-3.0.0-24fd6201a4782cf50561c810276afc7d12d71195/node_modules/is-number/", {"name":"is-number","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-number-2.1.0-01fcbbb393463a548f2f466cce16dece49db908f/node_modules/is-number/", {"name":"is-number","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-number-4.0.0-0026e37f5454d73e356dfe6564699867c6a7f0ff/node_modules/is-number/", {"name":"is-number","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-kind-of-3.2.2-31ea21a734bab9bbb0f32466d893aea51e4a3c64/node_modules/kind-of/", {"name":"kind-of","reference":"3.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-kind-of-4.0.0-20813df3d712928b207378691a45066fae72dd57/node_modules/kind-of/", {"name":"kind-of","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-kind-of-5.1.0-729c91e2d857b7a419a1f9aa65685c4c33f5845d/node_modules/kind-of/", {"name":"kind-of","reference":"5.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-kind-of-6.0.2-01146b36a6218e64e58f3a8d66de5d7fc6f6d051/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-buffer-1.1.6-efaa2ea9daa0d7ab2ea13a97b2b8ad51fefbe8be/node_modules/is-buffer/", {"name":"is-buffer","reference":"1.1.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-buffer-2.0.3-4ecf3fcf749cbd1e472689e109ac66261a25e725/node_modules/is-buffer/", {"name":"is-buffer","reference":"2.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-repeat-string-1.6.1-8dcae470e1c88abc2d600fff4a776286da75e637/node_modules/repeat-string/", {"name":"repeat-string","reference":"1.6.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-to-regex-range-2.1.1-7c80c17b9dfebe599e27367e0d4dd5590141db38/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-isobject-2.1.0-f065561096a3f1da2ef46272f815c840d87e0c89/node_modules/isobject/", {"name":"isobject","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-repeat-element-1.1.3-782e0d825c0c5a3bb39731f84efee6b742e6b1ce/node_modules/repeat-element/", {"name":"repeat-element","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-snapdragon-0.8.2-64922e7c565b0e14204ba1aa7d6964278d25182d/node_modules/snapdragon/", {"name":"snapdragon","reference":"0.8.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-base-0.11.2-7bde5ced145b6d551a90db87f83c558b4eb48a8f/node_modules/base/", {"name":"base","reference":"0.11.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-cache-base-1.0.1-0a7f46416831c8b662ee36fe4e7c59d76f666ab2/node_modules/cache-base/", {"name":"cache-base","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-collection-visit-1.0.0-4bc0373c164bc3291b4d368c829cf1a80a59dca0/node_modules/collection-visit/", {"name":"collection-visit","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-map-visit-1.0.0-ecdca8f13144e660f1b5bd41f12f3479d98dfb8f/node_modules/map-visit/", {"name":"map-visit","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-visit-1.0.1-f79c4493af0c5377b59fe39d395e41042dd045bb/node_modules/object-visit/", {"name":"object-visit","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-get-value-2.0.6-dc15ca1c672387ca76bd37ac0a395ba2042a2c28/node_modules/get-value/", {"name":"get-value","reference":"2.0.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-value-1.0.0-18b281da585b1c5c51def24c930ed29a0be6b177/node_modules/has-value/", {"name":"has-value","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-value-0.3.1-7b1f58bada62ca827ec0a2078025654845995e1f/node_modules/has-value/", {"name":"has-value","reference":"0.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-values-1.0.0-95b0b63fec2146619a6fe57fe75628d5a39efe4f/node_modules/has-values/", {"name":"has-values","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-values-0.1.4-6d61de95d91dfca9b9a02089ad384bff8f62b771/node_modules/has-values/", {"name":"has-values","reference":"0.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-set-value-2.0.0-71ae4a88f0feefbbf52d1ea604f3fb315ebb6274/node_modules/set-value/", {"name":"set-value","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-set-value-0.4.3-7db08f9d3d22dc7f78e53af3c3bf4666ecdfccf1/node_modules/set-value/", {"name":"set-value","reference":"0.4.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-split-string-3.1.0-7cb09dda3a86585705c64b39a6466038682e8fe2/node_modules/split-string/", {"name":"split-string","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-assign-symbols-1.0.0-59667f41fadd4f20ccbc2bb96b8d4f7f78ec0367/node_modules/assign-symbols/", {"name":"assign-symbols","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-to-object-path-0.3.0-297588b7b0e7e0ac08e04e672f85c1f4999e17af/node_modules/to-object-path/", {"name":"to-object-path","reference":"0.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-union-value-1.0.0-5c71c34cb5bad5dcebe3ea0cd08207ba5aa1aea4/node_modules/union-value/", {"name":"union-value","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-arr-union-3.1.0-e39b09aea9def866a8f206e288af63919bae39c4/node_modules/arr-union/", {"name":"arr-union","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-unset-value-1.0.0-8376873f7d2335179ffb1e6fc3a8ed0dfc8ab559/node_modules/unset-value/", {"name":"unset-value","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-class-utils-0.3.6-f93369ae8b9a7ce02fd41faad0ca83033190c463/node_modules/class-utils/", {"name":"class-utils","reference":"0.3.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-define-property-0.2.5-c35b1ef918ec3c990f9a5bc57be04aacec5c8116/node_modules/define-property/", {"name":"define-property","reference":"0.2.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-define-property-1.0.0-769ebaaf3f4a63aad3af9e8d304c9bbe79bfb0e6/node_modules/define-property/", {"name":"define-property","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-define-property-2.0.2-d459689e8d654ba77e02a817f8710d702cb16e9d/node_modules/define-property/", {"name":"define-property","reference":"2.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-descriptor-0.1.6-366d8240dde487ca51823b1ab9f07a10a78251ca/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"0.1.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-descriptor-1.0.2-3b159746a66604b04f8c81524ba365c5f14d86ec/node_modules/is-descriptor/", {"name":"is-descriptor","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-0.1.6-a9e12cb3ae8d876727eeef3843f8a0897b5c98d6/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"0.1.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-accessor-descriptor-1.0.0-169c2f6d3df1f992618072365c9b0ea1f6878656/node_modules/is-accessor-descriptor/", {"name":"is-accessor-descriptor","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-data-descriptor-0.1.4-0b5ee648388e2c860282e793f1856fec3f301b56/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"0.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-data-descriptor-1.0.0-d84876321d0e7add03990406abbbbd36ba9268c7/node_modules/is-data-descriptor/", {"name":"is-data-descriptor","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-static-extend-0.1.2-60809c39cbff55337226fd5e0b520f341f1fb5c6/node_modules/static-extend/", {"name":"static-extend","reference":"0.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-copy-0.1.0-7e7d858b781bd7c991a41ba975ed3812754e998c/node_modules/object-copy/", {"name":"object-copy","reference":"0.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-copy-descriptor-0.1.1-676f6eb3c39997c2ee1ac3a924fd6124748f578d/node_modules/copy-descriptor/", {"name":"copy-descriptor","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-mixin-deep-1.3.1-a49e7268dce1a0d9698e45326c5626df3543d0fe/node_modules/mixin-deep/", {"name":"mixin-deep","reference":"1.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-for-in-1.0.2-81068d295a8142ec0ac726c6e2200c30fb6d5e80/node_modules/for-in/", {"name":"for-in","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-pascalcase-0.1.1-b363e55e8006ca6fe21784d2db22bd15d7917f14/node_modules/pascalcase/", {"name":"pascalcase","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-map-cache-0.2.2-c32abd0bd6525d9b051645bb4f26ac5dc98a0dbf/node_modules/map-cache/", {"name":"map-cache","reference":"0.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-source-map-0.5.7-8a039d2d1021d22d1ea14c80d8ea468ba2ef3fcc/node_modules/source-map/", {"name":"source-map","reference":"0.5.7"}],
  ["../../../Library/Caches/Yarn/v4/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-source-map-resolve-0.5.2-72e2cc34095543e43b2c62b2c4c10d4a9054f259/node_modules/source-map-resolve/", {"name":"source-map-resolve","reference":"0.5.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-atob-2.1.2-6d9517eb9e030d2436666651e86bd9f6f13533c9/node_modules/atob/", {"name":"atob","reference":"2.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-decode-uri-component-0.2.0-eb3913333458775cb84cd1a1fae062106bb87545/node_modules/decode-uri-component/", {"name":"decode-uri-component","reference":"0.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-resolve-url-0.2.1-2c637fe77c893afd2a663fe21aa9080068e2052a/node_modules/resolve-url/", {"name":"resolve-url","reference":"0.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-source-map-url-0.4.0-3e935d7ddd73631b97659956d55128e87b5084a3/node_modules/source-map-url/", {"name":"source-map-url","reference":"0.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-urix-0.1.0-da937f7a62e21fec1fd18d49b35c2935067a6c72/node_modules/urix/", {"name":"urix","reference":"0.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-use-3.1.1-d50c8cac79a19fbc20f2911f56eb973f4e10070f/node_modules/use/", {"name":"use","reference":"3.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-snapdragon-node-2.1.1-6c175f86ff14bdb0724563e8f3c1b021a286853b/node_modules/snapdragon-node/", {"name":"snapdragon-node","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-snapdragon-util-3.0.1-f956479486f2acd79700693f6f7b805e45ab56e2/node_modules/snapdragon-util/", {"name":"snapdragon-util","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-to-regex-3.0.2-13cfdd9b336552f30b51f33a8ae1b42a7a7599ce/node_modules/to-regex/", {"name":"to-regex","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-regex-not-1.0.2-1f4ece27e00b0b65e0247a6810e6a85d83a5752c/node_modules/regex-not/", {"name":"regex-not","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-safe-regex-1.1.0-40a3669f3b077d1e943d44629e157dd48023bf2e/node_modules/safe-regex/", {"name":"safe-regex","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ret-0.1.15-b8a4825d5bdb1fc3f6f53c2bc33f81388681c7bc/node_modules/ret/", {"name":"ret","reference":"0.1.15"}],
  ["../../../Library/Caches/Yarn/v4/npm-extglob-2.0.4-ad00fe4dc612a9232e8718711dc5cb5ab0285543/node_modules/extglob/", {"name":"extglob","reference":"2.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-extglob-0.3.2-2e18ff3d2f49ab2765cec9023f011daa8d8349a1/node_modules/extglob/", {"name":"extglob","reference":"0.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-expand-brackets-2.1.4-b77735e315ce30f6b6eff0f83b04151a22449622/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"2.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-expand-brackets-0.1.5-df07284e342a807cd733ac5af72411e581d1177b/node_modules/expand-brackets/", {"name":"expand-brackets","reference":"0.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-posix-character-classes-0.1.1-01eac0fe3b5af71a2a6c02feabb8c1fef7e00eab/node_modules/posix-character-classes/", {"name":"posix-character-classes","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-fragment-cache-0.2.1-4290fad27f13e89be7f33799c6bc5a0abfff0d19/node_modules/fragment-cache/", {"name":"fragment-cache","reference":"0.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-nanomatch-1.2.13-b87a8aa4fc0de8fe6be88895b38983ff265bd119/node_modules/nanomatch/", {"name":"nanomatch","reference":"1.2.13"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-windows-1.0.2-d1850eb9791ecd18e6182ce12a30f396634bb19d/node_modules/is-windows/", {"name":"is-windows","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-pick-1.3.0-87a10ac4c1694bd2e1cbf53591a66141fb5dd747/node_modules/object.pick/", {"name":"object.pick","reference":"1.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-normalize-path-2.1.1-1ab28b556e198363a8c1a6f7e6fa20137fe6aed9/node_modules/normalize-path/", {"name":"normalize-path","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-remove-trailing-separator-1.1.0-c24bce2a283adad5bc3f58e0d48249b92379d8ef/node_modules/remove-trailing-separator/", {"name":"remove-trailing-separator","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-async-each-1.0.1-19d386a1d9edc6e7c1c85d388aedbcc56d33602d/node_modules/async-each/", {"name":"async-each","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-glob-parent-3.1.0-9e6af6299d8d3bd2bd40430832bd113df906c5ae/node_modules/glob-parent/", {"name":"glob-parent","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-glob-parent-2.0.0-81383d72db054fcccf5336daa902f182f6edbb28/node_modules/glob-parent/", {"name":"glob-parent","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-glob-3.1.0-7ba5ae24217804ac70707b96922567486cc3e84a/node_modules/is-glob/", {"name":"is-glob","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-glob-4.0.0-9521c76845cc2610a85203ddf080a958c2ffabc0/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-glob-2.0.1-d096f926a3ded5600f3fdfd91198cb0888c2d863/node_modules/is-glob/", {"name":"is-glob","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-extglob-1.0.0-ac468177c4943405a092fc8f29760c6ffc6206c0/node_modules/is-extglob/", {"name":"is-extglob","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-dirname-1.0.2-cc33d24d525e099a5388c0336c6e32b9160609e0/node_modules/path-dirname/", {"name":"path-dirname","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-binary-path-1.0.1-75f16642b480f187a711c814161fd3a4a7655898/node_modules/is-binary-path/", {"name":"is-binary-path","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-binary-extensions-1.12.0-c2d780f53d45bba8317a8902d4ceeaf3a6385b14/node_modules/binary-extensions/", {"name":"binary-extensions","reference":"1.12.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-lodash-debounce-4.0.8-82d79bff30a67c4005ffd5e2515300ad9ca4d7af/node_modules/lodash.debounce/", {"name":"lodash.debounce","reference":"4.0.8"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-readdirp-2.2.1-0e87622a3325aa33e892285caf8b4e846529a525/node_modules/readdirp/", {"name":"readdirp","reference":"2.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-graceful-fs-4.1.15-ffb703e1066e8a0eeaa4c8b80ba9253eeefbfb00/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.1.15"}],
  ["../../../Library/Caches/Yarn/v4/npm-readable-stream-2.3.6-b11c27d88b8ff1fbe070643cf94b0c79ae1b0aaf/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-readable-stream-3.1.1-ed6bbc6c5ba58b090039ff18ce670515795aeb06/node_modules/readable-stream/", {"name":"readable-stream","reference":"3.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-process-nextick-args-2.0.0-a37d732f4271b4ab1ad070d35508e8290788ffaa/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-string-decoder-1.2.0-fe86e738b19544afe70469243b2a1ee9240eae8d/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-upath-1.1.0-35256597e46a581db4793d0ce47fa9aebfc9fabd/node_modules/upath/", {"name":"upath","reference":"1.1.0"}],
  ["./.pnp/unplugged/npm-fsevents-1.2.7-4851b664a3783e52003b3c66eb0eee1074933aa4/node_modules/fsevents/", {"name":"fsevents","reference":"1.2.7"}],
  ["../../../Library/Caches/Yarn/v4/npm-nan-2.12.1-7b1aa193e9aa86057e3c7bbd0ac448e770925552/node_modules/nan/", {"name":"nan","reference":"2.12.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-node-pre-gyp-0.10.3-3070040716afdc778747b61b6887bf78880b80fc/node_modules/node-pre-gyp/", {"name":"node-pre-gyp","reference":"0.10.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-detect-libc-1.0.3-fa137c4bd698edf55cd5cd02ac559f91a4c4ba9b/node_modules/detect-libc/", {"name":"detect-libc","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../../Library/Caches/Yarn/v4/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284/node_modules/minimist/", {"name":"minimist","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-minimist-1.1.3-3bedfd91a92d39016fcfaa1c681e8faa1a1efda8/node_modules/minimist/", {"name":"minimist","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-needle-2.2.4-51931bff82533b1928b7d1d69e01f1b00ffd2a4e/node_modules/needle/", {"name":"needle","reference":"2.2.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../../Library/Caches/Yarn/v4/npm-iconv-lite-0.4.23-297871f63be507adcfbfca715d0cd0eed84e9a63/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.23"}],
  ["../../../Library/Caches/Yarn/v4/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-sax-1.2.4-2816234e2378bddc4e5354fab5caa895df7100d9/node_modules/sax/", {"name":"sax","reference":"1.2.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-nopt-4.0.1-d0d4685afd5415193c8c7505602d0d17cd64474d/node_modules/nopt/", {"name":"nopt","reference":"4.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8/node_modules/abbrev/", {"name":"abbrev","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-osenv-0.1.5-85cdfafaeb28e8677f416e287592b5f3f49ea410/node_modules/osenv/", {"name":"osenv","reference":"0.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3/node_modules/os-homedir/", {"name":"os-homedir","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274/node_modules/os-tmpdir/", {"name":"os-tmpdir","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-npm-packlist-1.2.0-55a60e793e272f00862c7089274439a4cc31fc7f/node_modules/npm-packlist/", {"name":"npm-packlist","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ignore-walk-3.0.1-a83e62e7d272ac0e3b551aaa82831a19b69f82f8/node_modules/ignore-walk/", {"name":"ignore-walk","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../../Library/Caches/Yarn/v4/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-npm-bundled-1.0.5-3c1732b7ba936b3a10325aef616467c0ccbcc979/node_modules/npm-bundled/", {"name":"npm-bundled","reference":"1.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-npmlog-4.1.2-08a7f2a8bf734604779a9efa4ad5cc717abb954b/node_modules/npmlog/", {"name":"npmlog","reference":"4.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-are-we-there-yet-1.1.5-4b35c2944f062a8bfcda66410760350fe9ddfc21/node_modules/are-we-there-yet/", {"name":"are-we-there-yet","reference":"1.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a/node_modules/delegates/", {"name":"delegates","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-console-control-strings-1.1.0-3d7cf4464db6446ea644bf4b39507f9851008e8e/node_modules/console-control-strings/", {"name":"console-control-strings","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-gauge-2.7.4-2c03405c7538c39d7eb37b317022e325fb018bf7/node_modules/gauge/", {"name":"gauge","reference":"2.7.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-aproba-1.2.0-6802e6264efd18c790a1b0d517f0f2627bf2c94a/node_modules/aproba/", {"name":"aproba","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-unicode-2.0.1-e0e6fe6a28cf51138855e086d1691e771de2a8b9/node_modules/has-unicode/", {"name":"has-unicode","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863/node_modules/object-assign/", {"name":"object-assign","reference":"4.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3/node_modules/string-width/", {"name":"string-width","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e/node_modules/string-width/", {"name":"string-width","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-string-width-3.0.0-5a1690a57cc78211fffd9bf24bbe24d090604eb1/node_modules/string-width/", {"name":"string-width","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77/node_modules/code-point-at/", {"name":"code-point-at","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d/node_modules/number-is-nan/", {"name":"number-is-nan","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-ansi-5.0.0-f78f68b5d0866c20b2c9b8c61b5298508dc8756f/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"5.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ansi-regex-4.0.0-70de791edf021404c3fd615aa89118ae0432e5a9/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-wide-align-1.1.3-ae074e6bdc0c14a431e804e624549c633b000457/node_modules/wide-align/", {"name":"wide-align","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7/node_modules/set-blocking/", {"name":"set-blocking","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed/node_modules/rc/", {"name":"rc","reference":"1.2.8"}],
  ["../../../Library/Caches/Yarn/v4/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac/node_modules/deep-extend/", {"name":"deep-extend","reference":"0.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927/node_modules/ini/", {"name":"ini","reference":"1.3.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab/node_modules/rimraf/", {"name":"rimraf","reference":"2.6.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-glob-7.1.3-3960832d3f1574108342dafd3a67b332c0969df1/node_modules/glob/", {"name":"glob","reference":"7.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-semver-5.6.0-7e74256fbaa49c75aa7c7a205cc22799cac80004/node_modules/semver/", {"name":"semver","reference":"5.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-tar-4.4.8-b19eec3fde2a96e64666df9fdb40c5ca1bc3747d/node_modules/tar/", {"name":"tar","reference":"4.4.8"}],
  ["../../../Library/Caches/Yarn/v4/npm-chownr-1.1.1-54726b8b8fff4df053c42187e801fb4412df1494/node_modules/chownr/", {"name":"chownr","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-fs-minipass-1.2.5-06c277218454ec288df77ada54a03b8702aacb9d/node_modules/fs-minipass/", {"name":"fs-minipass","reference":"1.2.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-minipass-2.3.5-cacebe492022497f656b0f0f51e2682a9ed2d848/node_modules/minipass/", {"name":"minipass","reference":"2.3.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-yallist-3.0.3-b4b049e314be545e3ce802236d6cd22cd91c3de9/node_modules/yallist/", {"name":"yallist","reference":"3.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-minizlib-1.2.1-dd27ea6136243c7c880684e8672bb3a45fd9b614/node_modules/minizlib/", {"name":"minizlib","reference":"1.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-connect-3.6.6-09eff6c55af7236e137135a72574858b6786f524/node_modules/connect/", {"name":"connect","reference":"3.6.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-finalhandler-1.1.0-ce0b6855b45853e791b2fcc680046d88253dd7f5/node_modules/finalhandler/", {"name":"finalhandler","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59/node_modules/encodeurl/", {"name":"encodeurl","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988/node_modules/escape-html/", {"name":"escape-html","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-on-finished-2.3.0-20f1336481b083cd75337992a16971aa2d906947/node_modules/on-finished/", {"name":"on-finished","reference":"2.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-parseurl-1.3.2-fc289d4ed8993119460c156253262cdc8de65bf3/node_modules/parseurl/", {"name":"parseurl","reference":"1.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-statuses-1.3.1-faf51b9eb74aaef3b3acf4ad5f61abf24cb7b93e/node_modules/statuses/", {"name":"statuses","reference":"1.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c/node_modules/statuses/", {"name":"statuses","reference":"1.5.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-statuses-1.4.0-bb73d446da2796106efcc1b601a253d6c46bd087/node_modules/statuses/", {"name":"statuses","reference":"1.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec/node_modules/unpipe/", {"name":"unpipe","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713/node_modules/utils-merge/", {"name":"utils-merge","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-dev-ip-1.0.1-a76a3ed1855be7a012bb8ac16cb80f3c00dc28f0/node_modules/dev-ip/", {"name":"dev-ip","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-easy-extender-2.3.4-298789b64f9aaba62169c77a2b3b64b4c9589b8f/node_modules/easy-extender/", {"name":"easy-extender","reference":"2.3.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-lodash-4.17.11-b39ea6229ef607ecd89e2c8df12536891cac9b8d/node_modules/lodash/", {"name":"lodash","reference":"4.17.11"}],
  ["../../../Library/Caches/Yarn/v4/npm-eazy-logger-3.0.2-a325aa5e53d13a2225889b2ac4113b2b9636f4fc/node_modules/eazy-logger/", {"name":"eazy-logger","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-tfunk-3.1.0-38e4414fc64977d87afdaa72facb6d29f82f7b5b/node_modules/tfunk/", {"name":"tfunk","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-chalk-1.1.3-a8115c55e4a702fe4d150abd3872822a7e09fc98/node_modules/chalk/", {"name":"chalk","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-ansi-styles-2.2.1-b432dd3358b634cf75e1e4664368240533c1ddbe/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"2.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-ansi-2.0.0-34f5049ce1ecdf2b0649af3ef24e45ed35416d91/node_modules/has-ansi/", {"name":"has-ansi","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-supports-color-2.0.0-535d045ce6b6363fa40117084629995e9df324c7/node_modules/supports-color/", {"name":"supports-color","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-supports-color-6.1.0-0764abc69c63d5ac842dd4867e8d025e880df8f3/node_modules/supports-color/", {"name":"supports-color","reference":"6.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-path-0.9.2-0fd9a74fc5fad1ae3968b586bda5c632bd6c05a5/node_modules/object-path/", {"name":"object-path","reference":"0.9.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-fs-extra-3.0.1-3794f378c58b342ea7dbbb23095109c4b3b62291/node_modules/fs-extra/", {"name":"fs-extra","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-jsonfile-3.0.1-a5ecc6f65f53f662c4415c7675a0331d0992ec66/node_modules/jsonfile/", {"name":"jsonfile","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-universalify-0.1.2-b646f69be3942dabcecc9d6639c80dc105efaa66/node_modules/universalify/", {"name":"universalify","reference":"0.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-http-proxy-1.15.2-642fdcaffe52d3448d2bda3b0079e9409064da31/node_modules/http-proxy/", {"name":"http-proxy","reference":"1.15.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-eventemitter3-1.2.0-1c86991d816ad1e504750e73874224ecf3bec508/node_modules/eventemitter3/", {"name":"eventemitter3","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff/node_modules/requires-port/", {"name":"requires-port","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-localtunnel-1.9.1-1d1737eab658add5a40266d8e43f389b646ee3b1/node_modules/localtunnel/", {"name":"localtunnel","reference":"1.9.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-axios-0.17.1-2d8e3e5d0bdbd7327f91bc814f5c57660f81824d/node_modules/axios/", {"name":"axios","reference":"0.17.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-follow-redirects-1.6.1-514973c44b5757368bad8bddfe52f81f015c94cb/node_modules/follow-redirects/", {"name":"follow-redirects","reference":"1.6.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-openurl-1.1.1-3875b4b0ef7a52c156f0db41d4609dbb0f94b387/node_modules/openurl/", {"name":"openurl","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-yargs-6.6.0-782ec21ef403345f830a808ca3d513af56065208/node_modules/yargs/", {"name":"yargs","reference":"6.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-yargs-6.4.0-816e1a866d5598ccf34e5596ddce22d92da490d4/node_modules/yargs/", {"name":"yargs","reference":"6.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-camelcase-3.0.0-32fc4b9fcdaf845fcdf7e73bb97cac2261f0ab0a/node_modules/camelcase/", {"name":"camelcase","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-camelcase-4.1.0-d545635be1e33c542649c69173e5de6acfae34dd/node_modules/camelcase/", {"name":"camelcase","reference":"4.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-cliui-3.2.0-120601537a916d29940f934da3b48d585a39213d/node_modules/cliui/", {"name":"cliui","reference":"3.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-wrap-ansi-2.1.0-d8fc3d284dd05794fe84973caecdd1cf824fdd85/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-decamelize-1.2.0-f6534d15148269b20352e7bee26f501f9a191290/node_modules/decamelize/", {"name":"decamelize","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-get-caller-file-1.0.3-f978fa4c90d1dfe7ff2d6beda2a515e713bdcf4a/node_modules/get-caller-file/", {"name":"get-caller-file","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-os-locale-1.4.0-20f9f17ae29ed345e8bde583b13d2009803c14d9/node_modules/os-locale/", {"name":"os-locale","reference":"1.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-lcid-1.0.0-308accafa0bc483a3867b4b6f2b9506251d1b835/node_modules/lcid/", {"name":"lcid","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-invert-kv-1.0.0-104a8e4aaca6d3d8cd157a8ef8bfab2d7a3ffdb6/node_modules/invert-kv/", {"name":"invert-kv","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-read-pkg-up-1.0.1-9d63c13276c065918d57f002a57f40a1b643fb02/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-read-pkg-up-3.0.0-3ed496685dba0f8fe118d0691dc51f4a1ff96f07/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-find-up-1.1.2-6b2e9822b1a2ce0a60ab64d610eccad53cb24d0f/node_modules/find-up/", {"name":"find-up","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7/node_modules/find-up/", {"name":"find-up","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-exists-2.1.0-0feb6c64f0fc518d9a754dd5efb62c7022761f4b/node_modules/path-exists/", {"name":"path-exists","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515/node_modules/path-exists/", {"name":"path-exists","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-pinkie-promise-2.0.1-2135d6dfa7a358c069ac9b178776288228450ffa/node_modules/pinkie-promise/", {"name":"pinkie-promise","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-pinkie-2.0.4-72556b80cfa0d48a974e80e77248e80ed4f7f870/node_modules/pinkie/", {"name":"pinkie","reference":"2.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-read-pkg-1.1.0-f5ffaa5ecd29cb31c0474bca7d756b6bb29e3f28/node_modules/read-pkg/", {"name":"read-pkg","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-read-pkg-3.0.0-9cbc686978fee65d16c00e2b19c237fcf6e38389/node_modules/read-pkg/", {"name":"read-pkg","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-load-json-file-1.1.0-956905708d58b4bab4c2261b04f59f31c99374c0/node_modules/load-json-file/", {"name":"load-json-file","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-load-json-file-4.0.0-2f5f45ab91e33216234fd53adab668eb4ec0993b/node_modules/load-json-file/", {"name":"load-json-file","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9/node_modules/parse-json/", {"name":"parse-json","reference":"2.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-parse-json-4.0.0-be35f5425be1f7f6c747184f98a788cb99477ee0/node_modules/parse-json/", {"name":"parse-json","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c/node_modules/pify/", {"name":"pify","reference":"2.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-pify-3.0.0-e5a4acd2c101fdf3d9a4d07f0dbc4db49dd28176/node_modules/pify/", {"name":"pify","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-pify-4.0.1-4b2cd25c50d598735c50292224fd8c6df41e3231/node_modules/pify/", {"name":"pify","reference":"4.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-bom-2.0.0-6219a85616520491f35788bdbf1447a99c7e6b0e/node_modules/strip-bom/", {"name":"strip-bom","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3/node_modules/strip-bom/", {"name":"strip-bom","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-utf8-0.2.1-4b0da1442104d1b336340e80797e865cf39f7d72/node_modules/is-utf8/", {"name":"is-utf8","reference":"0.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-normalize-package-data-2.4.0-12f95a307d58352075a04907b84ac8be98ac012f/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-hosted-git-info-2.7.1-97f236977bd6e125408930ff6de3eec6281ec047/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.7.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-builtin-module-1.0.0-540572d34f7ac3119f8f76c30cbc1b1e037affbe/node_modules/is-builtin-module/", {"name":"is-builtin-module","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-builtin-modules-1.1.1-270f076c5a72c02f5b65a47df94c5fe3a278892f/node_modules/builtin-modules/", {"name":"builtin-modules","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-spdx-license-ids-3.0.3-81c0ce8f21474756148bbb5f3bfc0f36bf15d76e/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-type-1.1.0-59c44f7ee491da704da415da5a4070ba4f8fe441/node_modules/path-type/", {"name":"path-type","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-type-3.0.0-cef31dc8e0a1a3bb0d105c0cd97cf3bf47f4e36f/node_modules/path-type/", {"name":"path-type","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42/node_modules/require-directory/", {"name":"require-directory","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-require-main-filename-1.0.1-97f717b69d48784f5f526a6c5aa8ffdda055a4d1/node_modules/require-main-filename/", {"name":"require-main-filename","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-which-module-1.0.0-bba63ca861948994ff307736089e3b96026c2a4f/node_modules/which-module/", {"name":"which-module","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-y18n-3.2.1-6d15fba884c08679c0d77e88e7759e811e07fa41/node_modules/y18n/", {"name":"y18n","reference":"3.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-yargs-parser-4.2.1-29cceac0dc4f03c6c87b4a9f217dd18c9f74871c/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"4.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-yargs-parser-10.1.0-7202265b89f7e9e9f2e5765e0fe735a905edbaa8/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"10.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-expand-range-1.8.2-a299effd335fe2721ebae8e257ec79644fc85337/node_modules/expand-range/", {"name":"expand-range","reference":"1.8.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-randomatic-3.1.1-b776efc59375984e36c537b2f51a1f0aff0da1ed/node_modules/randomatic/", {"name":"randomatic","reference":"3.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-math-random-1.0.4-5dd6943c938548267016d4e34f057583080c514c/node_modules/math-random/", {"name":"math-random","reference":"1.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-preserve-0.2.0-815ed1f6ebc65926f865b310c0713bcb3315ce4b/node_modules/preserve/", {"name":"preserve","reference":"0.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-posix-bracket-0.1.1-3334dc79774368e92f016e6fbc0a88f5cd6e6bc4/node_modules/is-posix-bracket/", {"name":"is-posix-bracket","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-filename-regex-2.0.1-c1c4b9bee3e09725ddb106b75c1e301fe2f18b26/node_modules/filename-regex/", {"name":"filename-regex","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-object-omit-2.0.1-1a9c744829f39dbb858c76ca3579ae2a54ebd1fa/node_modules/object.omit/", {"name":"object.omit","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-for-own-0.1.5-5265c681a4f294dabbf17c9509b6763aa84510ce/node_modules/for-own/", {"name":"for-own","reference":"0.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-parse-glob-3.0.4-b2c376cfb11f35513badd173ef0bb6e3a388391c/node_modules/parse-glob/", {"name":"parse-glob","reference":"3.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-glob-base-0.3.0-dbb164f6221b1c0b1ccf82aea328b497df0ea3c4/node_modules/glob-base/", {"name":"glob-base","reference":"0.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-dotfile-1.0.3-a6a2f32ffd2dfb04f5ca25ecd0f6b83cf798a1e1/node_modules/is-dotfile/", {"name":"is-dotfile","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-regex-cache-0.4.4-75bdc58a2a1496cec48a12835bc54c8d562336dd/node_modules/regex-cache/", {"name":"regex-cache","reference":"0.4.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-equal-shallow-0.1.3-2238098fc221de0bcfa5d9eac4c45d638aa1c534/node_modules/is-equal-shallow/", {"name":"is-equal-shallow","reference":"0.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-primitive-2.0.0-207bab91638499c07b2adf240a41a87210034575/node_modules/is-primitive/", {"name":"is-primitive","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-opn-5.3.0-64871565c863875f052cfdf53d3e3cb5adb53b1c/node_modules/opn/", {"name":"opn","reference":"5.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-wsl-1.1.0-1f16e4aa22b04d1336b66188a66af3c600c3a66d/node_modules/is-wsl/", {"name":"is-wsl","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-portscanner-2.1.1-eabb409e4de24950f5a2a516d35ae769343fbb96/node_modules/portscanner/", {"name":"portscanner","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-async-1.5.2-ec6a61ae56480c0c3cb241c95618e20892f9672a/node_modules/async/", {"name":"async","reference":"1.5.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-number-like-1.0.8-2e129620b50891042e44e9bbbb30593e75cfbbe3/node_modules/is-number-like/", {"name":"is-number-like","reference":"1.0.8"}],
  ["../../../Library/Caches/Yarn/v4/npm-lodash-isfinite-3.3.2-fb89b65a9a80281833f0b7478b3a5104f898ebb3/node_modules/lodash.isfinite/", {"name":"lodash.isfinite","reference":"3.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-qs-6.2.3-1cfcb25c10a9b2b483053ff39f5dfc9233908cfe/node_modules/qs/", {"name":"qs","reference":"6.2.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-raw-body-2.3.3-1b324ece6b5706e153855bc1148c65bb7f6ea0c3/node_modules/raw-body/", {"name":"raw-body","reference":"2.3.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048/node_modules/bytes/", {"name":"bytes","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d/node_modules/http-errors/", {"name":"http-errors","reference":"1.6.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9/node_modules/depd/", {"name":"depd","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-resp-modifier-6.0.2-b124de5c4fbafcba541f48ffa73970f4aa456b4f/node_modules/resp-modifier/", {"name":"resp-modifier","reference":"6.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-rx-4.1.0-a5f13ff79ef3b740fe30aa803fb09f98805d4782/node_modules/rx/", {"name":"rx","reference":"4.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-send-0.16.2-6ecca1e0f8c156d141597559848df64730a6bbc1/node_modules/send/", {"name":"send","reference":"0.16.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-destroy-1.0.4-978857442c44749e4206613e37946205826abd80/node_modules/destroy/", {"name":"destroy","reference":"1.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-mime-1.4.1-121f9ebc49e3766f311a76e1fa1c8003c4b03aa6/node_modules/mime/", {"name":"mime","reference":"1.4.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-range-parser-1.2.0-f49be6b487894ddc40dcc94a322f611092e00d5e/node_modules/range-parser/", {"name":"range-parser","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239/node_modules/serve-index/", {"name":"serve-index","reference":"1.9.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-accepts-1.3.5-eb777df6011723a3b14e8a72c0805c8e86746bd2/node_modules/accepts/", {"name":"accepts","reference":"1.3.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-mime-types-2.1.21-28995aa1ecb770742fe6ae7e58f9181c744b3f96/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.21"}],
  ["../../../Library/Caches/Yarn/v4/npm-mime-db-1.37.0-0b6a0ce6fdbe9576e25f1f2d2fde8830dc0ad0d8/node_modules/mime-db/", {"name":"mime-db","reference":"1.37.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-negotiator-0.6.1-2b327184e8992101177b28563fb5e7102acd0ca9/node_modules/negotiator/", {"name":"negotiator","reference":"0.6.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16/node_modules/batch/", {"name":"batch","reference":"0.6.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-serve-static-1.13.2-095e8472fd5b46237db50ce486a43f4b86c6cec1/node_modules/serve-static/", {"name":"serve-static","reference":"1.13.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-2.1.1-a069c5feabee3e6b214a75b40ce0652e1cfb9980/node_modules/socket.io/", {"name":"socket.io","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-engine-io-3.2.1-b60281c35484a70ee0351ea0ebff83ec8c9522a2/node_modules/engine.io/", {"name":"engine.io","reference":"3.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-base64id-1.0.0-47688cb99bb6804f0e06d3e763b1c32e57d8e6b6/node_modules/base64id/", {"name":"base64id","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-ultron-1.1.1-9fe1536a10a664a65266a1e3ccf85fd36302bc9c/node_modules/ultron/", {"name":"ultron","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-cookie-0.3.1-e7e0a1f9ef43b4c8ba925c5c5a96e806d16873bb/node_modules/cookie/", {"name":"cookie","reference":"0.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-socket-io-adapter-1.1.1-2a805e8a14d6372124dd9159ad4502f8cb07f06b/node_modules/socket.io-adapter/", {"name":"socket.io-adapter","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-ua-parser-js-0.7.17-e9ec5f9498b9ec910e7ae3ac626a805c4d09ecac/node_modules/ua-parser-js/", {"name":"ua-parser-js","reference":"0.7.17"}],
  ["../../../Library/Caches/Yarn/v4/npm-window-size-0.2.0-b4315bb4214a3d7058ebeee892e13fa24d98b075/node_modules/window-size/", {"name":"window-size","reference":"0.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-stylelint-9.10.1-5f0ee3701461dff1d68284e1386efe8f0677a75d/node_modules/stylelint/", {"name":"stylelint","reference":"9.10.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-autoprefixer-9.4.6-0ace275e33b37de16b09a5547dbfe73a98c1d446/node_modules/autoprefixer/", {"name":"autoprefixer","reference":"9.4.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-browserslist-4.4.1-42e828954b6b29a7a53e352277be429478a69062/node_modules/browserslist/", {"name":"browserslist","reference":"4.4.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-caniuse-lite-1.0.30000932-d01763e9ce77810962ca7391ff827b5949ce4272/node_modules/caniuse-lite/", {"name":"caniuse-lite","reference":"1.0.30000932"}],
  ["../../../Library/Caches/Yarn/v4/npm-electron-to-chromium-1.3.108-2e79a6fcaa4b3e7c75abf871505bda8e268c910e/node_modules/electron-to-chromium/", {"name":"electron-to-chromium","reference":"1.3.108"}],
  ["../../../Library/Caches/Yarn/v4/npm-node-releases-1.1.5-1dbee1380742125fe99e0476c456670bf3590b89/node_modules/node-releases/", {"name":"node-releases","reference":"1.1.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-normalize-range-0.1.2-2d10c06bdfd312ea9777695a4d28439456b75942/node_modules/normalize-range/", {"name":"normalize-range","reference":"0.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-num2fraction-1.2.2-6f682b6a027a4e9ddfa4564cd2589d1d4e669ede/node_modules/num2fraction/", {"name":"num2fraction","reference":"1.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-7.0.14-4527ed6b1ca0d82c53ce5ec1a2041c2346bbd6e5/node_modules/postcss/", {"name":"postcss","reference":"7.0.14"}],
  ["../../../Library/Caches/Yarn/v4/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-value-parser-3.3.1-9ff822547e2893213cf1c30efa51ac5fd1ba8281/node_modules/postcss-value-parser/", {"name":"postcss-value-parser","reference":"3.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-cosmiconfig-5.0.7-39826b292ee0d78eda137dfa3173bd1c21a43b04/node_modules/cosmiconfig/", {"name":"cosmiconfig","reference":"5.0.7"}],
  ["../../../Library/Caches/Yarn/v4/npm-import-fresh-2.0.0-d81355c15612d386c61f9ddd3922d4304822a546/node_modules/import-fresh/", {"name":"import-fresh","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-caller-path-2.0.0-468f83044e369ab2010fac5f06ceee15bb2cb1f4/node_modules/caller-path/", {"name":"caller-path","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-caller-callsite-2.0.0-847e0fce0a223750a9a027c54b33731ad3154134/node_modules/caller-callsite/", {"name":"caller-callsite","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-callsites-2.0.0-06eb84f00eea413da86affefacbffb36093b3c50/node_modules/callsites/", {"name":"callsites","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-resolve-from-3.0.0-b22c7af7d9d6881bc8b6e653335eebcb0a188748/node_modules/resolve-from/", {"name":"resolve-from","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6/node_modules/resolve-from/", {"name":"resolve-from","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-directory-0.3.1-61339b6f2475fc772fd9c9d83f5c8575dc154ae1/node_modules/is-directory/", {"name":"is-directory","reference":"0.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-js-yaml-3.12.1-295c8632a18a23e054cf5c9d3cecafe678167600/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.12.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../../Library/Caches/Yarn/v4/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71/node_modules/esprima/", {"name":"esprima","reference":"4.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-json-parse-better-errors-1.0.2-bb867cfb3450e69107c131d1c514bab3dc8bcaa9/node_modules/json-parse-better-errors/", {"name":"json-parse-better-errors","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-execall-1.0.0-73d0904e395b3cab0658b08d09ec25307f29bb73/node_modules/execall/", {"name":"execall","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-clone-regexp-1.0.1-051805cd33173375d82118fc0918606da39fd60f/node_modules/clone-regexp/", {"name":"clone-regexp","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-regexp-1.0.0-fd2d883545c46bac5a633e7b9a09e87fa2cb5069/node_modules/is-regexp/", {"name":"is-regexp","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-supported-regexp-flag-1.0.1-21ee16518d2c1dd3edd3e9a0d57e50207ac364ca/node_modules/is-supported-regexp-flag/", {"name":"is-supported-regexp-flag","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-file-entry-cache-4.0.0-633567d15364aefe0b299e1e217735e8f3a9f6e8/node_modules/file-entry-cache/", {"name":"file-entry-cache","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0/node_modules/flat-cache/", {"name":"flat-cache","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-flatted-2.0.0-55122b6536ea496b4b44893ee2608141d10d9916/node_modules/flatted/", {"name":"flatted","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3/node_modules/write/", {"name":"write","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-get-stdin-6.0.0-9e09bf712b360ab9225e812048f71fde9c89657b/node_modules/get-stdin/", {"name":"get-stdin","reference":"6.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-global-modules-2.0.0-997605ad2345f27f51539bea26574421215c7780/node_modules/global-modules/", {"name":"global-modules","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-global-prefix-3.0.0-fc85f73064df69f50421f47f883fe5b913ba9b97/node_modules/global-prefix/", {"name":"global-prefix","reference":"3.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-globby-9.0.0-3800df736dc711266df39b4ce33fe0d481f94c23/node_modules/globby/", {"name":"globby","reference":"9.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-array-union-1.0.2-9a34410e4f4e3da23dea375be5be70f24778ec39/node_modules/array-union/", {"name":"array-union","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-array-uniq-1.0.3-af6ac877a25cc7f74e058894753858dfdb24fdb6/node_modules/array-uniq/", {"name":"array-uniq","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-dir-glob-2.2.2-fa09f0694153c8918b18ba0deafae94769fc50c4/node_modules/dir-glob/", {"name":"dir-glob","reference":"2.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-fast-glob-2.2.6-a5d5b697ec8deda468d85a74035290a025a95295/node_modules/fast-glob/", {"name":"fast-glob","reference":"2.2.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-@mrmlnc-readdir-enhanced-2.2.1-524af240d1a360527b730475ecfa1344aa540dde/node_modules/@mrmlnc/readdir-enhanced/", {"name":"@mrmlnc/readdir-enhanced","reference":"2.2.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-call-me-maybe-1.0.1-26d208ea89e37b5cbde60250a15f031c16a4d66b/node_modules/call-me-maybe/", {"name":"call-me-maybe","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-glob-to-regexp-0.3.0-8c5a1494d2066c570cc3bfe4496175acc4d502ab/node_modules/glob-to-regexp/", {"name":"glob-to-regexp","reference":"0.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@nodelib-fs-stat-1.1.3-2b5a3ab3f918cca48a8c754c08168e3f03eba61b/node_modules/@nodelib/fs.stat/", {"name":"@nodelib/fs.stat","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-merge2-1.2.3-7ee99dbd69bb6481689253f018488a1b902b0ed5/node_modules/merge2/", {"name":"merge2","reference":"1.2.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc/node_modules/ignore/", {"name":"ignore","reference":"4.0.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-ignore-5.0.5-c663c548d6ce186fb33616a8ccb5d46e56bdbbf9/node_modules/ignore/", {"name":"ignore","reference":"5.0.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-slash-2.0.0-de552851a1759df3a8f206535442f5ec4ddeab44/node_modules/slash/", {"name":"slash","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-globjoin-0.1.4-2f4494ac8919e3767c5cbb691e9f463324285d43/node_modules/globjoin/", {"name":"globjoin","reference":"0.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-html-tags-2.0.0-10b30a386085f43cede353cc8fa7cb0deeea668b/node_modules/html-tags/", {"name":"html-tags","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-import-lazy-3.1.0-891279202c8a2280fdbd6674dbd8da1a1dfc67cc/node_modules/import-lazy/", {"name":"import-lazy","reference":"3.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-known-css-properties-0.11.0-0da784f115ea77c76b81536d7052e90ee6c86a8a/node_modules/known-css-properties/", {"name":"known-css-properties","reference":"0.11.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-leven-2.1.0-c2e7a9f772094dee9d34202ae8acce4687875580/node_modules/leven/", {"name":"leven","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-log-symbols-2.2.0-5740e1c5d6f0dfda4ad9323b5332107ef6b4c40a/node_modules/log-symbols/", {"name":"log-symbols","reference":"2.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-mathml-tag-names-2.1.0-490b70e062ee24636536e3d9481e333733d00f2c/node_modules/mathml-tag-names/", {"name":"mathml-tag-names","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-meow-5.0.0-dfc73d63a9afc714a5e371760eb5c88b91078aa4/node_modules/meow/", {"name":"meow","reference":"5.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-camelcase-keys-4.2.0-a2aa5fb1af688758259c32c141426d78923b9b77/node_modules/camelcase-keys/", {"name":"camelcase-keys","reference":"4.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-map-obj-2.0.0-a65cd29087a92598b8791257a523e021222ac1f9/node_modules/map-obj/", {"name":"map-obj","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-map-obj-1.0.1-d933ceb9205d82bdcf4886f6742bdc2b4dea146d/node_modules/map-obj/", {"name":"map-obj","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-quick-lru-1.1.0-4360b17c61136ad38078397ff11416e186dcfbb8/node_modules/quick-lru/", {"name":"quick-lru","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-decamelize-keys-1.1.0-d171a87933252807eb3cb61dc1c1445d078df2d9/node_modules/decamelize-keys/", {"name":"decamelize-keys","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-loud-rejection-1.6.0-5b46f80147edee578870f086d04821cf998e551f/node_modules/loud-rejection/", {"name":"loud-rejection","reference":"1.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-currently-unhandled-0.4.1-988df33feab191ef799a61369dd76c17adf957ea/node_modules/currently-unhandled/", {"name":"currently-unhandled","reference":"0.4.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-array-find-index-1.0.2-df010aa1287e164bbda6f9723b0a96a1ec4187a1/node_modules/array-find-index/", {"name":"array-find-index","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-minimist-options-3.0.2-fba4c8191339e13ecf4d61beb03f070103f3d954/node_modules/minimist-options/", {"name":"minimist-options","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-arrify-1.0.1-898508da2226f380df904728456849c1501a4b0d/node_modules/arrify/", {"name":"arrify","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-plain-obj-1.1.0-71a50c8429dfca773c92a390a4a03b39fcd51d3e/node_modules/is-plain-obj/", {"name":"is-plain-obj","reference":"1.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e/node_modules/locate-path/", {"name":"locate-path","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43/node_modules/p-locate/", {"name":"p-locate","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8/node_modules/p-limit/", {"name":"p-limit","reference":"1.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3/node_modules/p-try/", {"name":"p-try","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-redent-2.0.0-c1b2007b42d57eb1389079b3c8333639d5e1ccaa/node_modules/redent/", {"name":"redent","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-indent-string-3.2.0-4a5fd6d27cc332f37e5419a504dbb837105c9289/node_modules/indent-string/", {"name":"indent-string","reference":"3.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-strip-indent-2.0.0-5ef8db295d01e6ed6cbf7aab96998d7822527b68/node_modules/strip-indent/", {"name":"strip-indent","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-trim-newlines-2.0.0-b403d0b91be50c331dfc4b82eeceb22c3de16d20/node_modules/trim-newlines/", {"name":"trim-newlines","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-normalize-selector-0.2.0-d0b145eb691189c63a78d201dc4fdb1293ef0c03/node_modules/normalize-selector/", {"name":"normalize-selector","reference":"0.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-html-0.36.0-b40913f94eaacc2453fd30a1327ad6ee1f88b204/node_modules/postcss-html/", {"name":"postcss-html","reference":"0.36.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-htmlparser2-3.10.0-5f5e422dcf6119c0d983ed36260ce9ded0bee464/node_modules/htmlparser2/", {"name":"htmlparser2","reference":"3.10.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-domelementtype-1.3.1-d048c44b37b0d10a7f2a3d5fee3f4333d790481f/node_modules/domelementtype/", {"name":"domelementtype","reference":"1.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-domelementtype-1.1.3-bd28773e2642881aec51544924299c5cd822185b/node_modules/domelementtype/", {"name":"domelementtype","reference":"1.1.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-domhandler-2.4.2-8805097e933d65e85546f726d60f5eb88b44f803/node_modules/domhandler/", {"name":"domhandler","reference":"2.4.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-domutils-1.7.0-56ea341e834e06e6748af7a1cb25da67ea9f8c2a/node_modules/domutils/", {"name":"domutils","reference":"1.7.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-dom-serializer-0.1.0-073c697546ce0780ce23be4a28e293e40bc30c82/node_modules/dom-serializer/", {"name":"dom-serializer","reference":"0.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-entities-1.1.2-bdfa735299664dfafd34529ed4f8522a275fea56/node_modules/entities/", {"name":"entities","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-jsx-0.36.0-b7685ed3d070a175ef0aa48f83d9015bd772c82d/node_modules/postcss-jsx/", {"name":"postcss-jsx","reference":"0.36.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-core-7.2.2-07adba6dde27bb5ad8d8672f15fde3e08184a687/node_modules/@babel/core/", {"name":"@babel/core","reference":"7.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-code-frame-7.0.0-06e2ab19bdb535385559aabb5ba59729482800f8/node_modules/@babel/code-frame/", {"name":"@babel/code-frame","reference":"7.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-highlight-7.0.0-f710c38c8d458e6dd9a201afb637fcb781ce99e4/node_modules/@babel/highlight/", {"name":"@babel/highlight","reference":"7.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-esutils-2.0.2-0abf4f1caa5bcb1f7a9d8acc6dea4faaa04bac9b/node_modules/esutils/", {"name":"esutils","reference":"2.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499/node_modules/js-tokens/", {"name":"js-tokens","reference":"4.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-generator-7.3.0-f663838cd7b542366de3aa608a657b8ccb2a99eb/node_modules/@babel/generator/", {"name":"@babel/generator","reference":"7.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-types-7.3.0-61dc0b336a93badc02bf5f69c4cd8e1353f2ffc0/node_modules/@babel/types/", {"name":"@babel/types","reference":"7.3.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-to-fast-properties-2.0.0-dc5e698cbd079265bc73e0377681a4e4e83f616e/node_modules/to-fast-properties/", {"name":"to-fast-properties","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-jsesc-2.5.2-80564d2e483dacf6e8ef209650a67df3f0c283a4/node_modules/jsesc/", {"name":"jsesc","reference":"2.5.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-trim-right-1.0.1-cb2e1203067e0c8de1f614094b9fe45704ea6003/node_modules/trim-right/", {"name":"trim-right","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-helpers-7.3.1-949eec9ea4b45d3210feb7dc1c22db664c9e44b9/node_modules/@babel/helpers/", {"name":"@babel/helpers","reference":"7.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-template-7.2.2-005b3fdf0ed96e88041330379e0da9a708eb2907/node_modules/@babel/template/", {"name":"@babel/template","reference":"7.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-parser-7.3.1-8f4ffd45f779e6132780835ffa7a215fa0b2d181/node_modules/@babel/parser/", {"name":"@babel/parser","reference":"7.3.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-traverse-7.2.3-7ff50cefa9c7c0bd2d81231fdac122f3957748d8/node_modules/@babel/traverse/", {"name":"@babel/traverse","reference":"7.2.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-helper-function-name-7.1.0-a0ceb01685f73355d4360c1247f582bfafc8ff53/node_modules/@babel/helper-function-name/", {"name":"@babel/helper-function-name","reference":"7.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-helper-get-function-arity-7.0.0-83572d4320e2a4657263734113c42868b64e49c3/node_modules/@babel/helper-get-function-arity/", {"name":"@babel/helper-get-function-arity","reference":"7.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@babel-helper-split-export-declaration-7.0.0-3aae285c0311c2ab095d997b8c9a94cad547d813/node_modules/@babel/helper-split-export-declaration/", {"name":"@babel/helper-split-export-declaration","reference":"7.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-globals-11.10.0-1e09776dffda5e01816b3bb4077c8b59c24eaa50/node_modules/globals/", {"name":"globals","reference":"11.10.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-convert-source-map-1.6.0-51b537a8c43e0f04dec1993bffcdd504e758ac20/node_modules/convert-source-map/", {"name":"convert-source-map","reference":"1.6.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-json5-2.1.0-e7a0c62c48285c628d20a10b85c89bb807c32850/node_modules/json5/", {"name":"json5","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-resolve-1.10.0-3bdaaeaf45cc07f375656dfd2e54ed0810b101ba/node_modules/resolve/", {"name":"resolve","reference":"1.10.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-less-3.1.2-fb67e7ba351dbdf69de3c52eebd1184c52bfaea6/node_modules/postcss-less/", {"name":"postcss-less","reference":"3.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-markdown-0.36.0-7f22849ae0e3db18820b7b0d5e7833f13a447560/node_modules/postcss-markdown/", {"name":"postcss-markdown","reference":"0.36.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-remark-10.0.1-3058076dc41781bf505d8978c291485fe47667df/node_modules/remark/", {"name":"remark","reference":"10.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-remark-parse-6.0.3-c99131052809da482108413f87b0ee7f52180a3a/node_modules/remark-parse/", {"name":"remark-parse","reference":"6.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-collapse-white-space-1.0.4-ce05cf49e54c3277ae573036a26851ba430a0091/node_modules/collapse-white-space/", {"name":"collapse-white-space","reference":"1.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-alphabetical-1.0.2-1fa6e49213cb7885b75d15862fb3f3d96c884f41/node_modules/is-alphabetical/", {"name":"is-alphabetical","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-decimal-1.0.2-894662d6a8709d307f3a276ca4339c8fa5dff0ff/node_modules/is-decimal/", {"name":"is-decimal","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-whitespace-character-1.0.2-ede53b4c6f6fb3874533751ec9280d01928d03ed/node_modules/is-whitespace-character/", {"name":"is-whitespace-character","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-word-character-1.0.2-46a5dac3f2a1840898b91e576cd40d493f3ae553/node_modules/is-word-character/", {"name":"is-word-character","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-markdown-escapes-1.0.2-e639cbde7b99c841c0bacc8a07982873b46d2122/node_modules/markdown-escapes/", {"name":"markdown-escapes","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-parse-entities-1.2.0-9deac087661b2e36814153cb78d7e54a4c5fd6f4/node_modules/parse-entities/", {"name":"parse-entities","reference":"1.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-character-entities-1.2.2-58c8f371c0774ef0ba9b2aca5f00d8f100e6e363/node_modules/character-entities/", {"name":"character-entities","reference":"1.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-character-entities-legacy-1.1.2-7c6defb81648498222c9855309953d05f4d63a9c/node_modules/character-entities-legacy/", {"name":"character-entities-legacy","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-character-reference-invalid-1.1.2-21e421ad3d84055952dab4a43a04e73cd425d3ed/node_modules/character-reference-invalid/", {"name":"character-reference-invalid","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-alphanumerical-1.0.2-1138e9ae5040158dc6ff76b820acd6b7a181fd40/node_modules/is-alphanumerical/", {"name":"is-alphanumerical","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-hexadecimal-1.0.2-b6e710d7d07bb66b98cb8cece5c9b4921deeb835/node_modules/is-hexadecimal/", {"name":"is-hexadecimal","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-state-toggle-1.0.1-c3cb0974f40a6a0f8e905b96789eb41afa1cde3a/node_modules/state-toggle/", {"name":"state-toggle","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-trim-0.0.1-5858547f6b290757ee95cccc666fb50084c460dd/node_modules/trim/", {"name":"trim","reference":"0.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-trim-trailing-lines-1.1.1-e0ec0810fd3c3f1730516b45f49083caaf2774d9/node_modules/trim-trailing-lines/", {"name":"trim-trailing-lines","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-unherit-1.1.1-132748da3e88eab767e08fabfbb89c5e9d28628c/node_modules/unherit/", {"name":"unherit","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-xtend-4.0.1-a5c6d532be656e23db820efb943a1f04998d63af/node_modules/xtend/", {"name":"xtend","reference":"4.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-remove-position-1.1.2-86b5dad104d0bbfbeb1db5f5c92f3570575c12cb/node_modules/unist-util-remove-position/", {"name":"unist-util-remove-position","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-visit-1.4.0-1cb763647186dc26f5e1df5db6bd1e48b3cc2fb1/node_modules/unist-util-visit/", {"name":"unist-util-visit","reference":"1.4.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-visit-parents-2.0.1-63fffc8929027bee04bfef7d2cce474f71cb6217/node_modules/unist-util-visit-parents/", {"name":"unist-util-visit-parents","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-is-2.1.2-1193fa8f2bfbbb82150633f3a8d2eb9a1c1d55db/node_modules/unist-util-is/", {"name":"unist-util-is","reference":"2.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-vfile-location-2.0.4-2a5e7297dd0d9e2da4381464d04acc6b834d3e55/node_modules/vfile-location/", {"name":"vfile-location","reference":"2.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-remark-stringify-6.0.4-16ac229d4d1593249018663c7bddf28aafc4e088/node_modules/remark-stringify/", {"name":"remark-stringify","reference":"6.0.4"}],
  ["../../../Library/Caches/Yarn/v4/npm-ccount-1.0.3-f1cec43f332e2ea5a569fd46f9f5bde4e6102aff/node_modules/ccount/", {"name":"ccount","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-alphanumeric-1.0.0-4a9cef71daf4c001c1d81d63d140cf53fd6889f4/node_modules/is-alphanumeric/", {"name":"is-alphanumeric","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-longest-streak-2.0.2-2421b6ba939a443bb9ffebf596585a50b4c38e2e/node_modules/longest-streak/", {"name":"longest-streak","reference":"2.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-markdown-table-1.1.2-c78db948fa879903a41bce522e3b96f801c63786/node_modules/markdown-table/", {"name":"markdown-table","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-mdast-util-compact-1.0.2-c12ebe16fffc84573d3e19767726de226e95f649/node_modules/mdast-util-compact/", {"name":"mdast-util-compact","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-stringify-entities-1.3.2-a98417e5471fd227b3e45d3db1861c11caf668f7/node_modules/stringify-entities/", {"name":"stringify-entities","reference":"1.3.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-character-entities-html4-1.1.2-c44fdde3ce66b52e8d321d6c1bf46101f0150610/node_modules/character-entities-html4/", {"name":"character-entities-html4","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-unified-7.1.0-5032f1c1ee3364bd09da12e27fdd4a7553c7be13/node_modules/unified/", {"name":"unified","reference":"7.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-@types-unist-2.0.2-5dc0a7f76809b7518c0df58689cd16a19bd751c6/node_modules/@types/unist/", {"name":"@types/unist","reference":"2.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-@types-vfile-3.0.2-19c18cd232df11ce6fa6ad80259bc86c366b09b9/node_modules/@types/vfile/", {"name":"@types/vfile","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-@types-node-10.12.18-1d3ca764718915584fcd9f6344621b7672665c67/node_modules/@types/node/", {"name":"@types/node","reference":"10.12.18"}],
  ["../../../Library/Caches/Yarn/v4/npm-@types-vfile-message-1.0.1-e1e9895cc6b36c462d4244e64e6d0b6eaf65355a/node_modules/@types/vfile-message/", {"name":"@types/vfile-message","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-bail-1.0.3-63cfb9ddbac829b02a3128cd53224be78e6c21a3/node_modules/bail/", {"name":"bail","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-extend-3.0.2-f8b1136b4071fbd8eb140aff858b1019ec2915fa/node_modules/extend/", {"name":"extend","reference":"3.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-trough-1.0.3-e29bd1614c6458d44869fc28b255ab7857ef7c24/node_modules/trough/", {"name":"trough","reference":"1.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-vfile-3.0.1-47331d2abe3282424f4a4bb6acd20a44c4121803/node_modules/vfile/", {"name":"vfile","reference":"3.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-replace-ext-1.0.0-de63128373fcbf7c3ccfa4de5a480c45a67958eb/node_modules/replace-ext/", {"name":"replace-ext","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-stringify-position-1.1.2-3f37fcf351279dcbca7480ab5889bb8a832ee1c6/node_modules/unist-util-stringify-position/", {"name":"unist-util-stringify-position","reference":"1.1.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-vfile-message-1.1.1-5833ae078a1dfa2d96e9647886cd32993ab313e1/node_modules/vfile-message/", {"name":"vfile-message","reference":"1.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-x-is-string-0.1.0-474b50865af3a49a9c4657f05acd145458f77d82/node_modules/x-is-string/", {"name":"x-is-string","reference":"0.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-unist-util-find-all-after-1.0.2-9be49cfbae5ca1566b27536670a92836bf2f8d6d/node_modules/unist-util-find-all-after/", {"name":"unist-util-find-all-after","reference":"1.0.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-media-query-parser-0.2.3-27b39c6f4d94f81b1a73b8f76351c609e5cef244/node_modules/postcss-media-query-parser/", {"name":"postcss-media-query-parser","reference":"0.2.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-reporter-6.0.1-7c055120060a97c8837b4e48215661aafb74245f/node_modules/postcss-reporter/", {"name":"postcss-reporter","reference":"6.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-resolve-nested-selector-0.1.1-29ccbc7c37dedfac304e9fff0bf1596b3f6a0e4e/node_modules/postcss-resolve-nested-selector/", {"name":"postcss-resolve-nested-selector","reference":"0.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-safe-parser-4.0.1-8756d9e4c36fdce2c72b091bbc8ca176ab1fcdea/node_modules/postcss-safe-parser/", {"name":"postcss-safe-parser","reference":"4.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-sass-0.3.5-6d3e39f101a53d2efa091f953493116d32beb68c/node_modules/postcss-sass/", {"name":"postcss-sass","reference":"0.3.5"}],
  ["../../../Library/Caches/Yarn/v4/npm-gonzales-pe-4.2.3-41091703625433285e0aee3aa47829fc1fbeb6f2/node_modules/gonzales-pe/", {"name":"gonzales-pe","reference":"4.2.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-scss-2.0.0-248b0a28af77ea7b32b1011aba0f738bda27dea1/node_modules/postcss-scss/", {"name":"postcss-scss","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-selector-parser-3.1.1-4f875f4afb0c96573d5cf4d74011aee250a7e865/node_modules/postcss-selector-parser/", {"name":"postcss-selector-parser","reference":"3.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-dot-prop-4.2.0-1f19e0c2e1aa0e32797c49799f2837ac6af69c57/node_modules/dot-prop/", {"name":"dot-prop","reference":"4.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-is-obj-1.0.1-3e4729ac1f5fde025cd7d83a896dab9f4f67db0f/node_modules/is-obj/", {"name":"is-obj","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-indexes-of-1.0.1-f30f716c8e2bd346c7b67d3df3915566a7c05607/node_modules/indexes-of/", {"name":"indexes-of","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-uniq-1.0.1-b31c5ae8254844a3a8281541ce2b04b865a734ff/node_modules/uniq/", {"name":"uniq","reference":"1.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-postcss-syntax-0.36.2-f08578c7d95834574e5593a82dfbfa8afae3b51c/node_modules/postcss-syntax/", {"name":"postcss-syntax","reference":"0.36.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-specificity-0.4.1-aab5e645012db08ba182e151165738d00887b019/node_modules/specificity/", {"name":"specificity","reference":"0.4.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"7.0.3"}],
  ["../../../Library/Caches/Yarn/v4/npm-style-search-0.1.0-7958c793e47e32e07d2b5cafe5c0bf8e12e77902/node_modules/style-search/", {"name":"style-search","reference":"0.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-sugarss-2.0.0-ddd76e0124b297d40bf3cca31c8b22ecb43bc61d/node_modules/sugarss/", {"name":"sugarss","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-svg-tags-1.0.0-58f71cee3bd519b59d4b2a843b6c7de64ac04764/node_modules/svg-tags/", {"name":"svg-tags","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-table-5.2.2-61d474c9e4d8f4f7062c98c7504acb3c08aa738f/node_modules/table/", {"name":"table","reference":"5.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-ajv-6.7.0-e3ce7bb372d6577bb1839f1dfdfcbf5ad2948d96/node_modules/ajv/", {"name":"ajv","reference":"6.7.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-fast-deep-equal-2.0.1-7b05218ddf9667bf7f370bf7fdb2cb15fdd0aa49/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"2.0.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-fast-json-stable-stringify-2.0.0-d5142c0caee6b1189f87d3a76111064f86c8bbf2/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0/node_modules/uri-js/", {"name":"uri-js","reference":"4.2.2"}],
  ["../../../Library/Caches/Yarn/v4/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec/node_modules/punycode/", {"name":"punycode","reference":"2.1.1"}],
  ["../../../Library/Caches/Yarn/v4/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636/node_modules/slice-ansi/", {"name":"slice-ansi","reference":"2.1.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9/node_modules/astral-regex/", {"name":"astral-regex","reference":"1.0.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-stylelint-config-standard-18.2.0-6283149aba7f64f18731aef8f0abfb35cf619e06/node_modules/stylelint-config-standard/", {"name":"stylelint-config-standard","reference":"18.2.0"}],
  ["../../../Library/Caches/Yarn/v4/npm-stylelint-config-recommended-2.1.0-f526d5c771c6811186d9eaedbed02195fee30858/node_modules/stylelint-config-recommended/", {"name":"stylelint-config-recommended","reference":"2.1.0"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 174 && relativeLocation[173] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 174)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 162 && relativeLocation[161] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 162)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 160 && relativeLocation[159] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 160)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 156 && relativeLocation[155] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 156)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 154 && relativeLocation[153] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 154)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 152 && relativeLocation[151] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 152)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 148 && relativeLocation[147] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 148)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 142 && relativeLocation[141] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 142)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 122 && relativeLocation[121] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 122)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 118 && relativeLocation[117] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 118)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 112 && relativeLocation[111] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 112)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 108 && relativeLocation[107] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 108)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`,
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        },
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`,
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
