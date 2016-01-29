var proj4 = require('proj4');
var initProj4 = require('./initializeProj4');
var WorkerPool = require('./WorkerPool');

/**
 * Build tiles for a QuatreePrimitive from a wfs source
 * Create a Cesium Geometry from a structure
 * returned by createWfsGeometry worker
 *
 * @param options.url : the wfs source (mandat
 * @param options.layerName : the name of the layer to build the tiles
 * @param [options.textureBaseUrl=undefined] : the base url for textures, if any
 * @param [options.tileSize=500] : the approximate tile size in meters (will be rounded depending on the tliing scheme)
 * @param [options.loadDistance=3] : @todo explain the units... not realy intuitive
 * @param [options.zOffset=0] : offset in z direction
 * @param [options.fileRoot=.] : path to the root of the application directory
 * @param [options.properties=.] : list of semantic properties to load along the geometry
 */
var TileProvider = function(options){

    initProj4();
    
    if (!Cesium.defined(options.url) || !Cesium.defined(options.layerName)){
        throw new Cesium.DeveloperError('options.url and options.layer are required.');
    }
    this._url = options.url;
    this._layerName = options.layerName;
    this._textureBaseUrl = options.textureBaseUrl; // can be undefined
    this._loadDistance = Cesium.defined(options.loadDistance) ? options.loadDistance : 3;
    this._zOffset = Cesium.defined(options.zOffset) ? options.zOffset : 0;

    if (Cesium.defined(this._textureBaseUrl) && this._textureBaseUrl.slice(-1) != '/') {
        this._textureBaseUrl += '/';
    }

    if(Cesium.defined(options.properties)) {
        this._propertiesList = options.properties;
    } else {
        this._propertiesList = [];
    }

    this._quadtree = undefined;
    this._errorEvent = new Cesium.Event();
    this._ready = false; // until we actually have the response from GetCapabilities
    this._tilingScheme = new Cesium.GeographicTilingScheme(); // needed for ellispoid
    this._loadingPrimitives = {};
    this._availableTiles = {};
    this._loadedTiles = {};

    this._projectionMatrices = {};


    // get capabilities to finish setup and get ready
    this._getCapapilitesAndGetReady();
};

var DEGREES_PER_RADIAN = 180.0 / Math.PI;
var RADIAN_PER_DEGREEE = 1 / DEGREES_PER_RADIAN;

TileProvider
.TRICOUNT = 0;
TileProvider
.STATS = {};
TileProvider
._vertexShader = 
        'attribute vec3 position3DHigh;\n' +
        'attribute vec3 position3DLow;\n' +
        'attribute vec3 normal;\n' +
        'attribute vec2 st;\n' +
        'attribute vec3 color;\n' +
        'varying vec3 v_color;\n' +
        'varying vec3 v_normal;\n' +
        'varying vec3 v_normalEC;\n' +
        'varying vec2 v_st;\n' +
        'void main() \n' +
        '{\n' +
            'vec4 p = czm_computePosition();\n' +
            'v_normal = normal;\n' +
            'v_normalEC = czm_normal * normal;\n' +
            'v_st = st;\n' +
            'v_color = color;\n' +
            'gl_Position = czm_modelViewProjectionRelativeToEye * p;\n' +
        '}\n';
TileProvider
._fragmentShader = 
        'uniform sampler2D u_texture;\n' +
        'varying vec2 v_st;\n' +
        'varying vec3 v_normal;\n' +
        'varying vec3 v_normalEC;\n' +
        'varying float v_featureIndex;\n' +
        'varying vec3 v_color;\n' +
        'void main() \n' +
        '{\n' +
            'czm_materialInput materialInput;\n' +
            'materialInput.s = v_st.s;\n' +
            'materialInput.st = v_st;\n' +
            'materialInput.str = vec3(v_st, 0.0);\n' +
            'materialInput.normalEC = v_normalEC;\n' +
            'czm_material material = czm_getMaterial(materialInput);\n' +
            'vec3 diffuse = v_color;\n' +
            'gl_FragColor = vec4(diffuse*(0.5+czm_getLambertDiffuse(normalize(v_normalEC), czm_sunDirectionEC)) + material.emission, 1.0);\n' +
        '}\n';
Object.defineProperties(TileProvider
.prototype, {
    quadtree: {
        get: function() {
            return this._quadtree;
        },
        set: function(value) {
            this._quadtree = value;
        }
    },

    ready: {
        get: function() {
            return this._ready;
        }
    },

    tilingScheme: {
        get: function() {
            return this._tilingScheme;
        }
    },

    errorEvent: {
        get: function() {
            return this._errorEvent;
        }
    }
});


TileProvider
.prototype._getCapapilitesAndGetReady = function(){

    var url = this._url+'?query=getCity&city=' + this._layerName;
    var that = this;
    var urlToLoad = 2;
    Cesium.loadJson(url).then(function(json){
        
        try { // for debugging, otherwise error are caught and failure is silent
        tiles = json["tiles"];
        for(var i = 0; i < tiles.length; i++) {
            that._availableTiles[tiles[i]["id"]] = tiles[i]["bbox"];
        }

        urlToLoad--;
        if(urlToLoad === 0) {
            that._ready = true;            
        }
        

        } catch (err){
            console.error(err);
        }
    });



    url = this._url+'?query=getCities';
    Cesium.loadJson(url).then(function(json){
        try { // for debugging, otherwise error are caught and failure is silent

        json = json[that._layerName];
        var nativeExtent = json.extent;
        that._nativeExtent = [nativeExtent[0][0], nativeExtent[0][1], nativeExtent[1][0], nativeExtent[1][1]]; 
        that._srs = json.srs;
        that._tileSize = json.maxtilesize;

        var latlongExtent = that.projectBbox(that._nativeExtent);

        var nx, ny;
        nx = Math.ceil((that._nativeExtent[2] - that._nativeExtent[0]) / that._tileSize / 2);
        ny = Math.ceil((that._nativeExtent[3] - that._nativeExtent[1]) / that._tileSize / 2);

        var fittedExtent = [nativeExtent[0][0], nativeExtent[0][1], nativeExtent[0][0] + nx * 2 * that._tileSize, nativeExtent[0][1] + ny * 2 * that._tileSize];
        fittedExtentLatlong = that.projectBbox(fittedExtent);
        var betterExtent = new Cesium.Rectangle.fromDegrees(fittedExtentLatlong[0], fittedExtentLatlong[1], fittedExtentLatlong[2], fittedExtentLatlong[3]);

        that._tilingScheme = new Cesium.GeographicTilingScheme({
            rectangle : betterExtent, 
            numberOfLevelZeroTilesX : nx, 
            numberOfLevelZeroTilesY : ny
        });

        // defines the distance at which the data appears
        that._levelZeroMaximumError = (that._nativeExtent[3] - that._nativeExtent[1]) * 0.25 / (65 * ny) * that._loadDistance;

        that._workerPool = new WorkerPool(4, './Workers/createWfsGeometry.js');
        that._loadedBoxes = [];
        that._cachedPrimitives = {};

        that._colorFunction = function(properties){
            return new Cesium.Color(1.0,1.0,1.0,1.0);
        };

        that._nx = nx * 2;
        that._ny = ny * 2;

        that._tileLoaded = 0;
        that._tilePending = 0;

        urlToLoad--;
        if(urlToLoad === 0) {
            that._ready = true;            
        }

        } catch (err){
            console.error(err);
        }
    });

};

TileProvider
.prototype.projectBbox = function(localBbox) {
    var ws = [localBbox[0], localBbox[1]];
    var en = [localBbox[2], localBbox[3]];
    var wn = [localBbox[0], localBbox[3]];
    var es = [localBbox[2], localBbox[1]];
    ws = proj4(this._srs, 'EPSG:4326').forward(ws);
    en = proj4(this._srs, 'EPSG:4326').forward(en);
    wn = proj4(this._srs, 'EPSG:4326').forward(wn);
    es = proj4(this._srs, 'EPSG:4326').forward(es);

    return [ws[0] < wn[0] ? ws[0] : wn[0],
            ws[1] < es[1] ? ws[1] : es[1],
            es[0] > en[0] ? es[0] : en[0],
            wn[1] > en[1] ? wn[1] : en[1]];
};

TileProvider
.prototype.beginUpdate = function(frameState) {
    for(var p in this._loadingPrimitives) {
        this._loadingPrimitives[p].update(frameState);  // the primitives need to be updated to continue loading
    }
};

TileProvider
.prototype.endUpdate = function(frameState) {};

TileProvider
.prototype.getLevelMaximumGeometricError = function(level) {
    return this._levelZeroMaximumError / (1 << level);
};

TileProvider.prototype.loadTile = function(frameState, tile) {
    var that = this;
    if(tile === undefined) {
        return;
    }
    if (tile.state === Cesium.QuadtreeTileLoadState.START) {
        tile.data = {
            primitive: undefined,//new Cesium.PrimitiveCollection(),
            freeResources: function() {
                if (Cesium.defined(this.primitive)) {
                    //this.primitive.destroy();
                    //this.primitive = undefined;
                }
            }
        };

        tile.data.primitive = new Cesium.PrimitiveCollection();
        var earthRadius = 6371000;
        var tileSizeMeters = Math.abs(earthRadius*(tile.rectangle.south - tile.rectangle.north));

        tile.data.boundingSphere3D = Cesium.BoundingSphere.fromRectangle3D(tile.rectangle);
        tile.data.boundingSphere2D = Cesium.BoundingSphere.fromRectangle2D(tile.rectangle, frameState.mapProjection);

        var tileId = (tile.level - 1) + "/" + (-1 + this._ny * Math.pow(2, tile.level - 1) - tile.y) + "/" + tile.x;

        if(tileId in this._availableTiles) {
            var bbox = this.projectBbox(this._availableTiles[tileId]);
            var rectangle = Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]);
            tile.rectangle = rectangle;
            tile.data.boundingSphere3D = Cesium.BoundingSphere.fromRectangle3D(rectangle);
            this.prepareTile(tile, frameState);

            /*viewer.entities.add({
                name : tileId,
                rectangle : {
                    coordinates : rectangle,
                    material : Cesium.Color.RED.withAlpha(0.1),
                    height : 300 + 300 * tile.level,
                    outline : true,
                    outlineColor : Cesium.Color.RED
                }
            });*/
        } else if(tile.level === 0 || tile.level === 1) {
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
            tile.renderable = true;
        } else {
            var parentTileId = (tile.level - 2) + "/" + Math.floor((-1 + this._ny * Math.pow(2, tile.level - 1) - tile.y) / 2) + "/" + Math.floor(tile.x / 2);
            if(parentTileId in this._loadedTiles) { // if the parent tile is already loaded and the tile not available, the tile is empty
                tile.state = Cesium.QuadtreeTileLoadState.DONE;
                tile.renderable = true;
            }
        }
    }
};

TileProvider.prototype.computeTileVisibility = function(tile, frameState, occluders) {
    var boundingSphere;
    if (frameState.mode === Cesium.SceneMode.SCENE3D) {
        boundingSphere = tile.data.boundingSphere3D;
    } else {
        boundingSphere = tile.data.boundingSphere2D;
    }
    return frameState.cullingVolume.computeVisibility(boundingSphere);
};

TileProvider.prototype.updateForPick = function(frameState) {
    for(var p in this._loadedTiles) {   // probably not the most optimal way to do it
        this._loadedTiles[p].data.primitive.update(frameState);
    }
};

var subtractScratch = new Cesium.Cartesian3();

TileProvider.prototype.showTileThisFrame = function(tile, frameState) {
    tile.data.primitive.update(frameState);
    tile._distance = Math.max(0.0, Cesium.Cartesian3.magnitude(Cesium.Cartesian3.subtract(tile.data.boundingSphere3D.center, frameState.camera.positionWC, subtractScratch)) - tile.data.boundingSphere3D.radius);
};

TileProvider.prototype.isDestroyed = function() {
    return false;
};

TileProvider.prototype.destroy = function() {
    return Cesium.destroyObject(this);
};

TileProvider.geometryFromArrays = function(data){
    TileProvider.TRICOUNT += data.position.length / 9;
    var attributes = new Cesium.GeometryAttributes();
    attributes.position  = new Cesium.GeometryAttribute({
        componentDatatype : Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute : 3,
        values : data.position
    });
    attributes.st  = new Cesium.GeometryAttribute({
        componentDatatype : Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute : 2,
        values : data.st
    });
    attributes.normal = new Cesium.GeometryAttribute({
        componentDatatype : Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute : 3,
        values : data.normal
    });

    attributes.center = new Cesium.GeometryAttribute({
        componentDatatype : Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute : 3,
        values : new Float32Array(data.position.length)
    });

    for (var t=0; t<attributes.position.valueslength; t+=9){
        var i;
        for (i=0; i<9; i++){
            attributes.center.values[t+i%3] += attributes.values.position[t+i];
        }
        for (i=0; i<3; i++){
            attributes.center.values[t+i] /= 3;
        }
    }

    // TODO uncomment once tangent and binormals are valid
    //
    //attributes.tangent = new Cesium.GeometryAttribute({
    //    componentDatatype : Cesium.ComponentDatatype.FLOAT,
    //    componentsPerAttribute : 3,
    //    values : data.normal
    //});
    //attributes.binormal = new Cesium.GeometryAttribute({
    //    componentDatatype : Cesium.ComponentDatatype.FLOAT,
    //    componentsPerAttribute : 3,
    //    values : data.normal
    //});
    
    var center = new Cesium.Cartesian3(data.bsphere_center[0], 
                                       data.bsphere_center[1], 
                                       data.bsphere_center[2]);
    var geom = new Cesium.Geometry({
        attributes : attributes,
        indices : data.indices,
        primitiveType : Cesium.PrimitiveType.TRIANGLES,
        boundingSphere : new Cesium.BoundingSphere(center, data.bsphere_radius)
    });
    
    //geom = Cesium.GeometryPipeline.computeNormal( geom );
    //geom = Cesium.GeometryPipeline.computeBinormalAndTangent( geom );

    return geom;
};

// static 
TileProvider.computeMatrix = function(localPtList, cartesianPtList) {
    var pt1local = localPtList[0];
    var pt2local = localPtList[1];
    var pt3local = localPtList[2];

    var pt1cart = cartesianPtList[0];
    var pt2cart = cartesianPtList[1];
    var pt3cart = cartesianPtList[2];

    // translation lambert -> lambert origine en pt1
    var t0 = new Cesium.Cartesian3(-pt1local.x, -pt1local.y, 0);

    // définition de la transformation
    var t = pt1cart;

    var m = Cesium.Matrix4.fromTranslation(t);


    var u = new Cesium.Cartesian3();
    var v = new Cesium.Cartesian3();
    var w = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(pt2local, pt1local, u);
    Cesium.Cartesian3.subtract(pt3local, pt1local, v);
    Cesium.Cartesian3.cross(u,v,w);

    var up = new Cesium.Cartesian3();
    var vp = new Cesium.Cartesian3();
    var wp = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(pt2cart, pt1cart, up);
    Cesium.Cartesian3.subtract(pt3cart, pt1cart, vp);
    Cesium.Cartesian3.cross(up,vp,wp);

    var U = new Cesium.Matrix3(u.x,v.x,w.x,
                              u.y,v.y,w.y,
                              u.z,v.z,w.z);

    var Up = new Cesium.Matrix3(up.x,vp.x,wp.x,
                              up.y,vp.y,wp.y,
                              up.z,vp.z,wp.z);

    var Uinv = new Cesium.Matrix3();
    Cesium.Matrix3.inverse(U, Uinv);

    var M = new Cesium.Matrix3();
    Cesium.Matrix3.multiply(Up, Uinv, M);

    Cesium.Matrix4.multiplyByMatrix3(m, M, m);

    var M2 = new Cesium.Matrix4();
    Cesium.Matrix4.fromTranslation(t0, M2);
    Cesium.Matrix4.multiply(m, M2, m);

    return m;
};

TileProvider.prototype.matrixAtPoint = function(point) {
    // 500*500 tiling used for approximation matrices
    var tileSize = 500;
    var nx, ny;
    nx = Math.floor((point[0] - this._nativeExtent[0]) / tileSize);
    ny = Math.floor((point[1] - this._nativeExtent[1]) / tileSize);
    if([nx,ny] in this._projectionMatrices) {
        return this._projectionMatrices[[nx,ny]];
    }

    var deltaLong = (this._tilingScheme.rectangle.east - this._tilingScheme.rectangle.west) / this._tilingScheme.getNumberOfXTilesAtLevel(0) * tileSize / this._tileSize;
    var deltaLat = (this._tilingScheme.rectangle.north - this._tilingScheme.rectangle.south) / this._tilingScheme.getNumberOfXTilesAtLevel(0) * tileSize / this._tileSize;

    // matrix
    // triangle tile
    var pt1local = new Cesium.Cartesian3(this._nativeExtent[0] + nx * tileSize, this._nativeExtent[1] + ny * tileSize, 0);
    var pt2local = new Cesium.Cartesian3(this._nativeExtent[0] + (nx + 1) * tileSize, this._nativeExtent[1] + ny * tileSize, 0);
    var pt3local = new Cesium.Cartesian3(this._nativeExtent[0] + nx * tileSize, this._nativeExtent[1] + (ny + 1) * tileSize, 0);
    //var pt4local = new Cesium.Cartesian3(en[0], en[1], 0);

    var localArray = [pt1local, pt2local, pt3local];
    //var localArray2 = [pt4local, pt2local, pt3local];
    
    var ws = [pt1local.x, pt1local.y];
    var wn = [pt1local.x, pt3local.y]
    var en = [pt2local.x, pt3local.y];
    var es = [pt2local.x, pt1local.y];
    ws = proj4(this._srs, 'EPSG:4326').forward(ws);
    wn = proj4(this._srs, 'EPSG:4326').forward(wn);
    en = proj4(this._srs, 'EPSG:4326').forward(en);
    es = proj4(this._srs, 'EPSG:4326').forward(es);

    var pt1cart = new Cesium.Cartesian3.fromDegrees(ws[0], ws[1], this._zOffset);
    var pt2cart = new Cesium.Cartesian3.fromDegrees(es[0], es[1], this._zOffset);
    var pt3cart = new Cesium.Cartesian3.fromDegrees(wn[0], wn[1], this._zOffset);
    //var pt4cart = new Cesium.Cartesian3.fromDegrees(en[0], en[1], this._zOffset);

    var cartesianArray = [pt1cart, pt2cart, pt3cart];
    //var cartesianArray2 = [pt4cart, pt2cart, pt3cart];

    var m = TileProvider.computeMatrix(localArray, cartesianArray);
    //var m2 = TileProvider.computeMatrix(localArray2, cartesianArray2);

    this._projectionMatrices[[nx,ny]] = m;
    return m;
}

var DEBUG_POINTS = false;
var DEBUG_GRID = false;

TileProvider.prototype.prepareTile = function(tile, frameState) {
    var key = tile.x + ";" +  tile.y + ";" + tile.level;
    if(key in this._cachedPrimitives) {
        var cached = this._cachedPrimitives[key];
        for(var p = 0; p < cached.length; p++) {
            tile.data.primitive.add(cached[p].primitive);
        }
        tile.data.primitive.update(frameState);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        return;
    }

    this.addPendingTile();
    this._cachedPrimitives[key] = [];
    TileProvider.STATS[key] = {};
    TileProvider.STATS[key].start = (new Date()).getTime();
    tile.state = Cesium.QuadtreeTileLoadState.LOADING;

    TileProvider.STATS[key].matrix = (new Date()).getTime();

    // grid display
    if(DEBUG_GRID) {
        var colorPL;
        if( (tile.x + tile.y) % 2 === 0 ) colorPL = Cesium.Color.RED; else colorPL = Cesium.Color.BLUE;
        var p1 = new Cesium.Cartesian3(x0, y0, 300);
        var p2 = new Cesium.Cartesian3(x0, y1, 300);
        var p3 = new Cesium.Cartesian3(x1, y1, 300);
        var p4 = new Cesium.Cartesian3(x1, y0, 300);
        Cesium.Matrix4.multiplyByPoint(m, p1, p1);
        Cesium.Matrix4.multiplyByPoint(m, p2, p2);
        Cesium.Matrix4.multiplyByPoint(m, p3, p3);
        Cesium.Matrix4.multiplyByPoint(m, p4, p4);
        var bboxPL = [p1, p2, p3, p4, p1];
        viewer.entities.add({
                    polyline : {
                        positions : bboxPL,
                        width : 3,
                        material : new Cesium.PolylineGlowMaterialProperty({
                            glowPower : 0.2,
                            color : Cesium.Color.RED
                        })
                    }
                });
        var q1 = new Cesium.Cartesian3.fromRadians(tile.rectangle.west, tile.rectangle.south, 300);
        var q2 = new Cesium.Cartesian3.fromRadians(tile.rectangle.west, tile.rectangle.north, 300);
        var q3 = new Cesium.Cartesian3.fromRadians(tile.rectangle.east, tile.rectangle.north, 300);
        var q4 = new Cesium.Cartesian3.fromRadians(tile.rectangle.east, tile.rectangle.south, 300);
        var bboxPL2 = [q1, q2, q3, q4, q1];
        viewer.entities.add({
                    polyline : {
                        positions : bboxPL2,
                        width : 3,
                        material : new Cesium.PolylineGlowMaterialProperty({
                            glowPower : 0.2,
                            color : Cesium.Color.BLUE
                        })
                    }
                });
    }

    if(DEBUG_POINTS) {
        var width = Cesium.Cartesian3.distance(pt1local, pt2local);
        var height = Cesium.Cartesian3.distance(pt1local, pt3local);
        var nbOfPointsOnOneSide = 5;

        // seed points
        var points_srs = [];
        var points_4326 = [];
        var vectX = new Cesium.Cartesian3();
        var vectY = new Cesium.Cartesian3();
        Cesium.Cartesian3.subtract(pt2local, pt1local, vectX);
        Cesium.Cartesian3.subtract(pt3local, pt1local, vectY);
        Cesium.Cartesian3.divideByScalar(vectX, nbOfPointsOnOneSide, vectX);
        Cesium.Cartesian3.divideByScalar(vectY, nbOfPointsOnOneSide, vectY);
        for (var j=0; j<=nbOfPointsOnOneSide; j++){
            for (var k=0; k<=nbOfPointsOnOneSide; k++){
                var pt_srs = new Cesium.Cartesian3(pt1local.x, pt1local.y, 300);
                var vectX2 = new Cesium.Cartesian3();
                var vectY2 = new Cesium.Cartesian3();
                Cesium.Cartesian3.multiplyByScalar(vectX, k, vectX2);
                Cesium.Cartesian3.multiplyByScalar(vectY, j, vectY2);
                Cesium.Cartesian3.add(pt_srs, vectX2, pt_srs);
                Cesium.Cartesian3.add(pt_srs, vectY2, pt_srs);
                var arrayPt = [pt_srs.x, pt_srs.y];
                var arrayPt4326 = proj4(this._srs,'EPSG:4326').forward( arrayPt );
                var pt_4326 = new Cesium.Cartesian3.fromDegrees(arrayPt4326[0], arrayPt4326[1], 300 + this._zOffset);
                points_4326.push(pt_4326);

                Cesium.Matrix4.multiplyByPoint(m, pt_srs, pt_srs);
                points_srs.push( pt_srs );
            }
        }

        for(var debug_pt = 0; debug_pt < points_srs.length; debug_pt++)
        {
            viewer.entities.add({
                position : points_4326[debug_pt],
                point : {
                    show : true, // default
                    color : Cesium.Color.RED, // default: WHITE
                    pixelSize : 5 // default: 1
                }
            });
            viewer.entities.add({
                position : points_srs[debug_pt],
                point : {
                    show : true, // default
                    color : Cesium.Color.SKYBLUE, // default: WHITE
                    pixelSize : 5 // default: 1
                }
            });
        }
    }

    var that = this;
    var geomArray = [];
    var properties = {};

    var tileId = (tile.level - 1) + "/" + (-1 + this._ny * Math.pow(2, tile.level - 1) - tile.y) + "/" + tile.x;
    var request = this._url + "?city=" + this._layerName + "&format=GeoJSON&query=getGeometry&tile=" + tileId;
    if(this._propertiesList.length != 0) {
        request += "&attributes="
        for(var i in this._propertiesList) {
            request += this._propertiesList[i] + ",";
        }
        request = request.slice(0,-1);
    }


    var tileY = -1 + that._ny * Math.pow(2, tile.level - 1) - tile.y;
    var xOffset = that._nativeExtent[0] + tile.x * (that._tileSize / Math.pow(2, tile.level - 1));
    var yOffset = that._nativeExtent[1] + tileY * (that._tileSize / Math.pow(2, tile.level - 1));
    var offsetTranslation = new Cesium.Cartesian3(xOffset, yOffset, 0);
    var offsetMatrix = new Cesium.Matrix4();
    Cesium.Matrix4.fromTranslation(offsetTranslation, offsetMatrix);

    this._workerPool.enqueueJob({request : request}, function(w){
        if (tile.data.primitive === undefined){
            if(w.data.geom !== undefined) return;   // TODO : cancel request in stead of waiting for its completion
            // tile suppressed while we waited for reply
            // receive messages from worker until done
            that._workerPool.releaseWorker(w.data.workerId);
            tile.state = Cesium.QuadtreeTileLoadState.START;
            tile.renderable = false;
            delete that._cachedPrimitives[key];
            that.removePendingTile();
            return;
        }
        if (w.data.geom !== undefined){
            var transformationMatrix;
            /*var diag = [es[0] - wn[0], es[1] - wn[1]];
            var vectP = [w.data.geom.bsphere_center[0] - wn[0], w.data.geom.bsphere_center[1] - wn[1]];
            if(diag[0] * vectP[1] - diag[1] * vectP[0] < 0) {
                transformationMatrix = m;
            }
            else {
                transformationMatrix = m2;
            }*/

            var geomCenter = [w.data.geom.bsphere_center[0], w.data.geom.bsphere_center[1]];
            geomCenter[0] += xOffset;
            geomCenter[1] += yOffset;
            transformationMatrix = Cesium.Matrix4.clone(that.matrixAtPoint(geomCenter));

            Cesium.Matrix4.multiply(transformationMatrix, offsetMatrix, transformationMatrix);

            var idx = geomArray.length;
            var geomProperties = JSON.parse(w.data.geom.properties);
            geomProperties.tileX = tile.x;
            geomProperties.tileY = tileY;
            geomProperties.tileZ = tile.level - 1;
            geomProperties.center = geomCenter;

            geomProperties.color = that._colorFunction(geomProperties);
            w.data.geom.color = geomProperties.color;
            properties[geomProperties.gid] = geomProperties;
            var attributes = {color : new Cesium.ColorGeometryInstanceAttribute(geomProperties.color.red, geomProperties.color.green, geomProperties.color.blue)};
            geomArray[idx] = new Cesium.GeometryInstance({
                modelMatrix : transformationMatrix,
                geometry : TileProvider.geometryFromArrays(w.data.geom),
                id : geomProperties.gid,
                attributes : attributes
            });
            /*properties[idx] = JSON.parse(w.data.geom.properties);
            properties[idx].tileX = tile.x;
            properties[idx].tileY = tile.y;*/
            return;
        }
        var prim = new Cesium.Primitive({
            geometryInstances: geomArray,
            //releaseGeometryInstances: false,
            appearance : new Cesium.MaterialAppearance({
                material : new Cesium.Material({
                    fabric : {
                        type : 'DiffuseMap',
                        components : {
                            diffuse :  'vec3(0.5,0.,1.)',
                            specular : '0.1'
                        }
                    }
                }),
                vertexShaderSource : TileProvider._vertexShader,
                fragmentShaderSource : TileProvider._fragmentShader
            }),
            asynchronous : false
        });
        prim.properties = properties;
        that._cachedPrimitives[key].push({/*bbox:w.data.geom.bbox,*/ primitive:prim});
        tile.data.primitive.add(prim);

        // Adding new available tiles
        tiles = w.data.tiles;
        for(var i = 0; i < tiles.length; i++) {
            that._availableTiles[tiles[i]["id"]] = tiles[i]["bbox"];
        }
        delete that._loadingPrimitives[w.data.workerId];
        that._loadedTiles[tileId] = tile;

        that._workerPool.releaseWorker(w.data.workerId);
        tile.data.primitive.update(frameState);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        that.addLoadedTile();
        TileProvider.STATS[key].geom_stats = w.data.stats;
        TileProvider.STATS[key].end = (new Date()).getTime();
    });
};

/* Return a list of 2D boxes (long lat in degrees) that are not already loaded
 * for a considered region of interest
 */
TileProvider.prototype.boxes = function(bbox){
    var loadedBoxes = this._loadedBoxes;
    var i, j;
    // check if box is covered by another one
    for (i=0; i<loadedBoxes.length; i++){
        if (covers(loadedBoxes[i], bbox)) return {needed:[], available:bbox};
    }

    // check if pieces are already there (eg zooming out)
    var level = 0;
    var covered = [];
    for (i=0; i<loadedBoxes.length; i++){
        if (covers(bbox, loadedBoxes[i])){
            // the level of the box in the quad tree, could be 1,2,4,8...
            level = Math.max(level, int((loadedBoxes[i][2]-loadedBoxes[i][0])/(bbox[2]-bbox[0])) - 1);
            covered.push(loadedBoxes[i]);
        }
    }

    // create all boxes for the level
    var neededBoxes = [];
    var availableBoxes = [];
    var nbBoxes = Math.pow(4, level);
    var levelUp = level+1;
    var size = [(bbox[2]-bbox[0])/levelUp, (bbox[3]-bbox[1])/levelUp];
    for (i=0; i<nbBoxes; i++){
        var b = [bbox[0]+(i%levelUp)*size[0], bbox[1]+(i/levelUp)*size[1],
                 bbox[0]+(i%levelUp + 1)*size[0], bbox[1]+(i/levelUp + 1)*size[1]];
        for (j=0; j<covered.length; j++){
            if (covers(covered[j], b)) break;
        }
        if (j==covered.length) neededBoxes.push(b);
        else availableBoxes.push(b);
    }
    return {needed:neededBoxes, available:availableBoxes};
};

/* Cleanup the list of loaded boxes
 */
TileProvider.prototype.boxLoaded = function(bbox){
    var loadedBoxes = this._loadedBoxes;
    for (i=loadedBoxes.length-1; i>=0; i--){
        if (covers(bbox, loadedBoxes[i])) loadedBoxes.splice(i, 1);
    }
    loadedBoxes.push(bbox);
};

TileProvider.prototype.setColorFunction = function(colorFunction){
    this._colorFunction = colorFunction;
    var cached = this._cachedPrimitives;
    // update cached primitives
    for(var t in cached) {
        for(var p = 0; p < cached[t].length; p++) {
            var prim = cached[t][p].primitive;
            for(var i in prim.properties) {//for(var i = 0; i < prim.properties.length; i++) {
                var attributes = prim.getGeometryInstanceAttributes(i);
                var color = colorFunction(prim.properties[i]);
                prim.properties[i].color = color;
                attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color);
            }
        }
    }
};

TileProvider.prototype.addPendingTile = function () {
    this._tilePending++;
    this.updateProgress();
};

TileProvider.prototype.addLoadedTile = function () {
    this._tilePending--;
    this._tileLoaded++;
    this.updateProgress();
};

TileProvider.prototype.removePendingTile = function () {
    this._tilePending--;
    this.updateProgress();
};

TileProvider.prototype.updateProgress = function () {
    var d = document.getElementById("info");
    var tot = this._tilePending + this._tileLoaded;
    if(d) {
        d.innerHTML = "<b>" + this._tileLoaded + "/" + tot + "</b>";        
    }
};

module.exports = TileProvider;