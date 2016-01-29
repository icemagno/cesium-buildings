var HtmlPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        lyon : "./LyonGeom.js",
    },
    output: {
        path: __dirname + '/public',
        filename: "[name].js"
    },
    plugins: [
        new HtmlPlugin({
            template: 'index.html',
            filename: 'lyon.html',
            inject : true
        })
    ],
    devServer: {
        contentBase: './public',
    },
    module: {
        loaders: [
            { test: /\.css$/, loader: "style!css" },
            {
                test: /\.(png|gif|jpg|jpeg)$/,
                loader: 'file-loader'
            },
            { test: /Cesium\.js$/, loader: 'script' },
            { test: /\.json$/, loader: 'json-loader' }
        ]
    }
};
