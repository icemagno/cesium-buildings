var HtmlPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        WorkerBundle : "./js/Workers/WorkerBundle.js"
    },
    output: {
        path: __dirname + '/public/Workers',
        filename: "[name].js"
    }
};
