"use strict";

const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const glob = require("glob");
const path = require("path");

/**
 * Grunt configuration for building the app in various formats.
 *
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2017
 * @license Apache-2.0
 */

const chainCommands = function(cmds) {
    const win = process.platform === "win32";
    if (!win) {
        return cmds.join(";");
    }
    return cmds
        // Chain Command is different here
        .join("&&")
        // Windows does not support \n properly
        .replace("\n", "\\n");
};

module.exports = function (grunt) {
    grunt.file.defaultEncoding = "utf8";
    grunt.file.preserveBOM = false;

    // Tasks
    grunt.registerTask("dev",
        "A persistent task which creates a development build whenever source files are modified.",
        ["clean:dev", "clean:config", "exec:generateConfig", "concurrent:dev"]);

    grunt.registerTask("prod",
        "Creates a production-ready build. Use the --msg flag to add a compile message.",
        [
            "eslint", "clean:prod", "clean:config", "exec:generateConfig", "webpack:web",
            "copy:standalone", "zip:standalone", "clean:standalone", "chmod"
        ]);

    grunt.registerTask("node",
        "Compiles CyberChef into a single NodeJS module.",
        [
            "clean:node", "clean:config", "clean:nodeConfig", "exec:generateConfig", "exec:generateNodeIndex"
        ]);

    grunt.registerTask("test",
        "A task which runs all the operation tests in the tests directory.",
        [
            "clean:config", "clean:nodeConfig", "exec:generateConfig", "exec:generateNodeIndex",
            "exec:nodeTests", "exec:opTests"
        ]);

    grunt.registerTask("testui",
        "A task which runs all the UI tests in the tests directory. The prod task must already have been run.",
        ["connect:prod", "exec:browserTests"]);

    grunt.registerTask("testnodeconsumer",
        "A task which checks whether consuming CJS and ESM apps work with the CyberChef build",
        ["exec:setupNodeConsumers", "exec:testCJSNodeConsumer", "exec:testESMNodeConsumer", "exec:testESMDeepImportNodeConsumer", "exec:teardownNodeConsumers"]);

    grunt.registerTask("default",
        "Lints the code base",
        ["eslint", "exec:repoSize"]);

    grunt.registerTask("tests", "test");
    grunt.registerTask("lint", "eslint");


    // Load tasks provided by each plugin
    grunt.loadNpmTasks("grunt-eslint");
    grunt.loadNpmTasks("grunt-webpack");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks("grunt-contrib-copy");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks("grunt-chmod");
    grunt.loadNpmTasks("grunt-exec");
    grunt.loadNpmTasks("grunt-accessibility");
    grunt.loadNpmTasks("grunt-concurrent");
    grunt.loadNpmTasks("grunt-contrib-connect");
    grunt.loadNpmTasks("grunt-zip");


    // Project configuration
    const compileTime = grunt.template.today("UTC:dd/mm/yyyy HH:MM:ss") + " UTC",
        pkg = grunt.file.readJSON("package.json"),
        webpackConfig = require("./webpack.config.js"),
        BUILD_CONSTANTS = {
            COMPILE_TIME: JSON.stringify(compileTime),
            COMPILE_MSG: JSON.stringify(grunt.option("compile-msg") || grunt.option("msg") || ""),
            PKG_VERSION: JSON.stringify(pkg.version),
        },
        moduleEntryPoints = listEntryModules(),
        nodeConsumerTestPath = "~/tmp-cyberchef";


    /**
     * Generates an entry list for all the modules.
     */
    function listEntryModules() {
        const entryModules = {};

        glob.sync("./src/core/config/modules/*.mjs").forEach(file => {
            const basename = path.basename(file);
            if (basename !== "Default.mjs" && basename !== "OpModules.mjs")
                entryModules["modules/" + basename.split(".mjs")[0]] = path.resolve(file);
        });

        return entryModules;
    }

    grunt.initConfig({
        clean: {
            dev: ["build/dev/*"],
            prod: ["build/prod/*"],
            node: ["build/node/*"],
            config: ["src/core/config/OperationConfig.json", "src/core/config/modules/*", "src/code/operations/index.mjs"],
            nodeConfig: ["src/node/index.mjs", "src/node/config/OperationConfig.json"],
            standalone: ["build/prod/CyberChef*.html"]
        },
        eslint: {
            options: {
                configFile: "./.eslintrc.json"
            },
            configs: ["*.{js,mjs}"],
            core: ["src/core/**/*.{js,mjs}", "!src/core/vendor/**/*", "!src/core/operations/legacy/**/*"],
            web: ["src/web/**/*.{js,mjs}", "!src/web/static/**/*"],
            node: ["src/node/**/*.{js,mjs}"],
            tests: ["tests/**/*.{js,mjs}"],
        },
        accessibility: {
            options: {
                accessibilityLevel: "WCAG2A",
                verbose: false,
                ignore: [
                    "WCAG2A.Principle1.Guideline1_3.1_3_1.H42.2"
                ]
            },
            test: {
                src: ["build/**/*.html"]
            }
        },
        webpack: {
            options: webpackConfig,
            web: () => {
                return {
                    mode: "production",
                    target: "web",
                    entry: Object.assign({
                        main: "./src/web/index.js"
                    }, moduleEntryPoints),
                    output: {
                        path: __dirname + "/build/prod",
                        filename: chunkData => {
                            return chunkData.chunk.name === "main" ? "assets/[name].js": "[name].js";
                        },
                        globalObject: "this"
                    },
                    resolve: {
                        alias: {
                            "./config/modules/OpModules.mjs": "./config/modules/Default.mjs"
                        }
                    },
                    plugins: [
                        new webpack.DefinePlugin(BUILD_CONSTANTS),
                        new HtmlWebpackPlugin({
                            filename: "index.html",
                            template: "./src/web/html/index.html",
                            chunks: ["main"],
                            compileTime: compileTime,
                            version: pkg.version,
                            minify: {
                                removeComments: true,
                                collapseWhitespace: true,
                                minifyJS: true,
                                minifyCSS: true
                            }
                        }),
                        new BundleAnalyzerPlugin({
                            analyzerMode: "static",
                            reportFilename: "BundleAnalyzerReport.html",
                            openAnalyzer: false
                        }),
                    ]
                };
            },
        },
        "webpack-dev-server": {
            options: {
                webpack: webpackConfig,
                host: "0.0.0.0",
                disableHostCheck: true,
                overlay: true,
                inline: false,
                clientLogLevel: "error",
                stats: {
                    children: false,
                    chunks: false,
                    modules: false,
                    entrypoints: false,
                    warningsFilter: [
                        /source-map/,
                        /dependency is an expression/,
                        /export 'default'/,
                        /Can't resolve 'sodium'/
                    ],
                }
            },
            start: {
                webpack: {
                    mode: "development",
                    target: "web",
                    entry: Object.assign({
                        main: "./src/web/index.js"
                    }, moduleEntryPoints),
                    resolve: {
                        alias: {
                            "./config/modules/OpModules.mjs": "./config/modules/Default.mjs"
                        }
                    },
                    plugins: [
                        new webpack.DefinePlugin(BUILD_CONSTANTS),
                        new HtmlWebpackPlugin({
                            filename: "index.html",
                            template: "./src/web/html/index.html",
                            chunks: ["main"],
                            compileTime: compileTime,
                            version: pkg.version,
                        })
                    ]
                }
            }
        },
        zip: {
            standalone: {
                cwd: "build/prod/",
                src: [
                    "build/prod/**/*",
                    "!build/prod/index.html",
                    "!build/prod/BundleAnalyzerReport.html",
                ],
                dest: `build/prod/CyberChef_v${pkg.version}.zip`
            }
        },
        connect: {
            prod: {
                options: {
                    port: 8000,
                    base: "build/prod/"
                }
            }
        },
        copy: {
            ghPages: {
                options: {
                    process: function (content, srcpath) {
                        if (srcpath.indexOf("index.html") >= 0) {
                            // Add Google Analytics code to index.html
                            content = content.replace("</body></html>",
                                grunt.file.read("src/web/static/ga.html") + "</body></html>");

                            // Add Structured Data for SEO
                            content = content.replace("</head>",
                                "<script type='application/ld+json'>" +
                                JSON.stringify(JSON.parse(grunt.file.read("src/web/static/structuredData.json"))) +
                                "</script></head>");
                            return grunt.template.process(content, srcpath);
                        } else {
                            return content;
                        }
                    },
                    noProcess: ["**", "!**/*.html"]
                },
                files: [
                    {
                        src: "build/prod/index.html",
                        dest: "build/prod/index.html"
                    }
                ]
            },
            standalone: {
                options: {
                    process: function (content, srcpath) {
                        if (srcpath.indexOf("index.html") >= 0) {
                            // Replace download link with version number
                            content = content.replace(/<a [^>]+>Download CyberChef.+?<\/a>/,
                                `<span>Version ${pkg.version}</span>`);

                            return grunt.template.process(content, srcpath);
                        } else {
                            return content;
                        }
                    },
                    noProcess: ["**", "!**/*.html"]
                },
                files: [
                    {
                        src: "build/prod/index.html",
                        dest: `build/prod/CyberChef_v${pkg.version}.html`
                    }
                ]
            }
        },
        chmod: {
            build: {
                options: {
                    mode: "755",
                },
                src: ["build/**/*", "build/"]
            }
        },
        watch: {
            config: {
                files: ["src/core/operations/**/*", "!src/core/operations/index.mjs"],
                tasks: ["exec:generateNodeIndex", "exec:generateConfig"]
            }
        },
        concurrent: {
            dev: ["watch:config", "webpack-dev-server:start"],
            options: {
                logConcurrentOutput: true
            }
        },
        exec: {
            repoSize: {
                command: chainCommands([
                    "git ls-files | wc -l | xargs printf '\n%b\ttracked files\n'",
                    "du -hs | egrep -o '^[^\t]*' | xargs printf '%b\trepository size\n'"
                ]),
                stderr: false
            },
            cleanGit: {
                command: "git gc --prune=now --aggressive"
            },
            sitemap: {
                command: "node --experimental-modules --no-warnings --no-deprecation src/web/static/sitemap.mjs > build/prod/sitemap.xml"
            },
            generateConfig: {
                command: chainCommands([
                    "echo '\n--- Regenerating config files. ---'",
                    "echo [] > src/core/config/OperationConfig.json",
                    "node --experimental-modules --no-warnings --no-deprecation src/core/config/scripts/generateOpsIndex.mjs",
                    "node --experimental-modules --no-warnings --no-deprecation src/core/config/scripts/generateConfig.mjs",
                    "echo '--- Config scripts finished. ---\n'"
                ])
            },
            generateNodeIndex: {
                command: chainCommands([
                    "echo '\n--- Regenerating node index ---'",
                    "node --experimental-modules --no-warnings --no-deprecation src/node/config/scripts/generateNodeIndex.mjs",
                    "echo '--- Node index generated. ---\n'"
                ]),
            },
            opTests: {
                command: "node --experimental-modules --no-warnings --no-deprecation tests/operations/index.mjs"
            },
            browserTests: {
                command: "./node_modules/.bin/nightwatch --env prod"
            },
            nodeTests: {
                command: "node --experimental-modules --no-warnings --no-deprecation tests/node/index.mjs"
            },
            setupNodeConsumers: {
                command: chainCommands([
                    "echo '\n--- Testing node conumers ---'",
                    "npm link",
                    `mkdir ${nodeConsumerTestPath}`,
                    `cp tests/node/consumers/* ${nodeConsumerTestPath}`,
                    `cd ${nodeConsumerTestPath}`,
                    "npm link cyberchef"
                ]),
            },
            teardownNodeConsumers: {
                command: chainCommands([
                    `rm -rf ${nodeConsumerTestPath}`,
                    "echo '\n--- Node consumer tests complete ---'"
                ]),
            },
            testCJSNodeConsumer: {
                command: chainCommands([
                    `cd ${nodeConsumerTestPath}`,
                    "node --no-warnings cjs-consumer.js",
                ]),
                stdout: false,
            },
            testESMNodeConsumer: {
                command: chainCommands([
                    `cd ${nodeConsumerTestPath}`,
                    "node --no-warnings --experimental-modules esm-consumer.mjs",
                ]),
                stdout: false,
            },
            testESMDeepImportNodeConsumer: {
                command: chainCommands([
                    `cd ${nodeConsumerTestPath}`,
                    "node --no-warnings --experimental-modules esm-deep-import-consumer.mjs",
                ]),
                stdout: false,
            },
        },
    });
};
