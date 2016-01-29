var HtmlPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        createWfsGeometry : "./js/createWfsGeometry.js"
    },
    output: {
        path: __dirname + '/public/Workers',
        filename: "[name].js"
    }
};
