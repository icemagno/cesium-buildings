/*jshint node:true,unused:true*/
'use strict';

/*global require*/

var fs = require('fs');
var glob = require('glob-all');
var gulp = require('gulp');
var browserify = require('browserify');
var uglify = require('gulp-uglify');
var sourcemaps = require('gulp-sourcemaps');
var exorcist = require('exorcist');
var buffer = require('vinyl-buffer');
var transform = require('vinyl-transform');
var source = require('vinyl-source-stream');
var resolve = require('resolve');

var workerGlob = ['./lib/createWfsGeometry.js'];

function createExorcistTransform(name) {
    return transform(function () { return exorcist('wwwroot/build' + name + '.map'); });
}

// Create the build directory, because browserify flips out if the directory that might
// contain an existing source map doesn't exist.
if (!fs.existsSync('wwwroot')) {
    fs.mkdirSync('wwwroot');
}
if (!fs.existsSync('wwwroot/build')) {
    fs.mkdirSync('wwwroot/build');
}

gulp.task('prepare-cesium-buildings', ['build-workers']);

gulp.task('default', ['prepare-cesium-buildings']);

gulp.task('goldcoast', ['prepare-cesium-buildings', 'build-goldcoast', 'copy-cesium-assets']);

gulp.task('build-goldcoast',  function() {
    var b = browserify({
        debug: true
    });

    b.add('./GoldCoast.js')

    return b.bundle()
     .pipe(source('GoldCoast.js'))
     .pipe(gulp.dest('wwwroot/build'));

});

gulp.task('copy-cesium-assets', function() {
    var cesium = resolve.sync('terriajs-cesium/wwwroot', {
        basedir: __dirname,
        extentions: ['.'],
        isFile: function(file) {
            try { return fs.statSync(file).isDirectory(); }
            catch (e) { return false; }
        }
    });
    return gulp.src([
            cesium + '/**'
        ], { base: cesium })
        .pipe(gulp.dest('wwwroot/build/Cesium'));
});

gulp.task('build-workers', function() {
    var b = browserify({
        debug: true
    });

    b.add('./lib/createWfsGeometry.js')

    return b.bundle()
        .pipe(source('createWfsGeometry.js'))
        .pipe(gulp.dest('wwwroot/build'));
});
