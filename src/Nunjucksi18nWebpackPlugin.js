"use strict";

const fs = require("fs-extra");
const path = require("path");
const nunjucks = require("nunjucks");
const objToString = require("./objToString")
const pluginName = "NunjucksI18nWebpackPlugin";

class NunjucksI18nWebpackPlugin {
  constructor(options) {
    this.options = Object.assign(
      {},
      {
        configure: {
          options: {},
          path: ""
        },
        templates: [],
      },
      options || {}
    );

    if (
      !Array.isArray(this.options.templates) ||
      this.options.templates.length === 0
    ) {
      throw new Error("Options `templates` must be an empty array");
    }
  }

  apply(compiler) {
    const fileDependencies = [];

    let output = compiler.options.output.path;

    if (
      output === "/" &&
      compiler.options.devServer &&
      compiler.options.devServer.outputPath
    ) {
      output = compiler.options.devServer.outputPath;
    }
    // setup hooks for webpack 4
    if (compiler.hooks) {
      compiler.hooks.compilation.tap('NjkWebpackPluginHooks', compilation => {
        const AsyncSeriesWaterfallHook = require('nunjucks-i18n-webpack-plugin/src/node_modules/tapable').AsyncSeriesWaterfallHook;
        compilation.hooks.njkWebpackPluginBeforeHtmlProcessing = new AsyncSeriesWaterfallHook(['pluginArgs']);
      });
    }
    const emitCallback = (compilation, callback) => {
      const configure =
        this.options.configure instanceof nunjucks.Environment
          ? this.options.configure
          : nunjucks.configure(
              this.options.configure.path,
              this.options.configure.options
            );

      const promises = [];

      const baseContext = {
        __webpack__: {
          hash: compilation.hash
        }
      };

      this.options.templates.forEach(template => {
        if (!template.from) {
          throw new Error("Each template should have `from` option");
        }

        if (!template.to) {
          throw new Error("Each template should have `to` option");
        }

        if(!template.language){
          throw new Error("language is required")
        }

        if(!template.unmatch){
          throw new Error("Unmatch is required")
        }

        if(!template.pattern){
          throw new Error("Pattern is required")
        }

        if (fileDependencies.indexOf(template.from) === -1) {
          fileDependencies.push(template.from);
        }
        
        const res = configure.render(
          template.from,
          Object.assign(baseContext, template.context),
          template.callback ? template.callback : null
        );

        let webpackTo = template.to;

        if (path.isAbsolute(webpackTo)) {
          webpackTo = path.relative(output, webpackTo);
        }

        const finalhtml = res.replace(
          template.pattern,
          (matche, $1, $2, $3) => {
            const language = template.language
            const json = require(language)
            const key = $1.trim();
            const val = json[key]
            if (!key || val === false) {
              return template.unmatch + "[" + key + "]";
            } else {
              if (typeof val === "function") {
                const fileName = htmlPluginData.outputName;
                if ($2 === "()") {
                  const result = val.call(language, fileName);
                  return objToString(result);
                } else if ($3) {
                  const result = val.apply(
                    language,
                    $3.split(",").map(item => item.trim()).concat(fileName)
                  );
                  return objToString(result);
                } else {
                  return objToString(val);
                }
              } else {
                return objToString(val);
              }
            }
          }
        );
          
        const source = {
          size: () => res.length,
          source: () => finalhtml
        };

        compilation.assets[webpackTo] = source;

        if (template.writeToFileEmit) {
          const fileDest = path.join(output, webpackTo);

          promises.push(fs.outputFile(fileDest, source.source()));
        }
      });

      return (
        Promise.all(promises)
          // eslint-disable-next-line promise/no-callback-in-promise
          .then(() => callback())
          .catch(error => {
            compilation.errors.push(error);

            // eslint-disable-next-line promise/no-callback-in-promise
            return callback();
          })
      );
    };

    const afterEmitCallback = (compilation, callback) => {
      let compilationFileDependencies = compilation.fileDependencies;
      let addFileDependency = file => compilation.fileDependencies.add(file);

      if (Array.isArray(compilation.fileDependencies)) {
        compilationFileDependencies = new Set(compilation.fileDependencies);
        addFileDependency = file => compilation.fileDependencies.push(file);
      }

      for (const file of fileDependencies) {
        if (!compilationFileDependencies.has(file)) {
          addFileDependency(file);
        }
      }

      return callback();
    };

    if (compiler.hooks) {
      compiler.hooks.emit.tapAsync(pluginName, emitCallback);
      compiler.hooks.afterEmit.tapAsync(pluginName, afterEmitCallback);
    } else {
      compiler.plugin("emit", emitCallback);
      compiler.plugin("after-emit", afterEmitCallback);
    }
  }
}

module.exports = NunjucksI18nWebpackPlugin;
