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
 */
var WfsTileProvider = function(options){
    
    if (!Cesium.defined(options.url) || !Cesium.defined(options.layerName)){
        throw new Cesium.DeveloperError('options.url and options.layer are required.');
    }
    this._url = options.url;
    this._layerName = options.layerName;
    this._textureBaseUrl = options.textureBaseUrl; // can be undefined
    this._tileSize = Cesium.defined(options.tileSize) ? options.tileSize : 500;
    this._loadDistance = Cesium.defined(options.loadDistance) ? options.loadDistance : 3;
    this._zOffset = Cesium.defined(options.zOffset) ? options.zOffset : 0;

    if (Cesium.defined(this._textureBaseUrl) && this._textureBaseUrl.slice(-1) != '/'){
        this._textureBaseUrl += '/';
    }

    this._quadtree = undefined;
    this._errorEvent = new Cesium.Event();
    this._ready = false; // until we actually have the response from GetCapabilities
    this._tilingScheme = new Cesium.GeographicTilingScheme(); // needed for ellispoid

    this._updateProgress = Cesium.defined(options.onUpdateProgress) ? options.onUpdateProgress : null;
    this._boxLoaded = Cesium.defined(options.boxLoaded) ? options.boxLoaded : null;
    this._requestFeature = Cesium.defined(options.onRequestFeature) ? options.onRequestFeature : null;
    this._endUpdate = Cesium.defined(options.endUpdate) ? options.endUpdate : null;
    this._beginUpdate = Cesium.defined(options.beginUpdate) ? options.beginUpdate : null;
    this._onLoadTile = Cesium.defined(options.onLoadTile) ? options.onLoadTile : null;
    this._primitiveLoaded = Cesium.defined(options.onPrimitiveLoaded) ? options.onPrimitiveLoaded : null;
    this._getCapabilities = Cesium.defined(options.getCapabilities) ? options.getCapabilities : null;
    this._onGetReady = Cesium.defined(options.onGetReady) ? options.onGetReady : null;
    this._onComputeTileVisibility = Cesium.defined(options.onComputeTileVisibility) ? options.onComputeTileVisibility : null;
    this._onComputeDistanceToTile = Cesium.defined(options.onComputeDistanceToTile) ? options.onComputeDistanceToTile : null;
    this._drawDebugPolyLine = Cesium.defined(options.onDrawDebugPolyLine) ? options.onDrawDebugPolyLine : null;
    this._beforeLoadTile = Cesium.defined(options.onBeforeLoadTile) ? options.onBeforeLoadTile : null;
    this._onPrepareTile = Cesium.defined(options.onPrepareTile) ? options.onPrepareTile : null;
    
	this._debugPoints = Cesium.defined(options.debugPoints) ? options.debugPoints : false;
	this._debugGrid = Cesium.defined(options.debugGrid) ? options.debugGrid : false;
	
    // get capabilities to finish setup and get ready
    this._getCapapilitesAndGetReady();
};

var DEGREES_PER_RADIAN = 180.0 / Math.PI;
var RADIAN_PER_DEGREEE = 1 / DEGREES_PER_RADIAN;
var subtractScratch = new Cesium.Cartesian3();

WfsTileProvider.TRICOUNT = 0;
WfsTileProvider.STATS = {};
WfsTileProvider._vertexShader = 
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
WfsTileProvider._fragmentShader = 
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
Object.defineProperties(WfsTileProvider.prototype, {
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
        },
        set: function( value ){
        	this._ready = value;
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


WfsTileProvider.prototype._getCapapilitesAndGetReady = function(){
    var url = this._url+'?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetCapabilities';
    var that = this;
    
    Cesium.loadXML(url).then(function(xml){
        
		if( that._getCapabilities !== null ){
			that._getCapabilities( url, xml );
		}	
		
		
    	// for debugging, otherwise error are caught and failure is silent
        try { 

	        // Is this really a GetCapabilities response?
	        if (!xml || !xml.documentElement || (xml.documentElement.localName !== 'WFS_Capabilities')) {
	            throw Cesium.RuntimeError("The response from the WFS server doen't like at GetCapabilities response url:"+url);
	        }
	
	        var featureTypes = xml.getElementsByTagName('FeatureType');
	        var extentWGS84 = undefined;
	        that._srs = undefined;
	        
	        for (var i=0; i<featureTypes.length; i++) {
	            if (featureTypes[i].getElementsByTagName('Name')[0].childNodes[0].nodeValue == that._layerName){
	                extent = featureTypes[i].getElementsByTagName('LatLongBoundingBox')[0];
	                that._srs = featureTypes[i].getElementsByTagName('SRS')[0].childNodes[0].nodeValue;
					break;
	            }
	        }
	
	        if (!Cesium.defined(extent) || !Cesium.defined(that._srs)){
	            throw Cesium.RuntimeError("No layer "+that._layerName+" in url:"+url);
	        }
	
	
	        extent = new Cesium.Rectangle.fromDegrees(
                extent.getAttribute('minx'),
                extent.getAttribute('miny'),
                extent.getAttribute('maxx'),
                extent.getAttribute('maxy')
	        );
	
	
	        var minExtent = new Cesium.Cartographic(extent.west, extent.south);
	    //    var maxExtent = new Cesium.Cartographic(extent.east, extent.north);
	        var p1 = new Cesium.Cartographic(extent.east, extent.south);
	        var p2 = new Cesium.Cartographic(extent.west, extent.north);
	        var nx, ny;
	        var geodesic = new Cesium.EllipsoidGeodesic(minExtent, p1);
	        nx = Math.ceil(geodesic.surfaceDistance / that._tileSize / 2);
	        geodesic.setEndPoints(minExtent, p2);
	        ny = Math.ceil(geodesic.surfaceDistance / that._tileSize / 2);
	        // TODO : fix extent
	        
	        
	        that._tilingScheme = new Cesium.GeographicTilingScheme({
	            rectangle : extent, 
	            numberOfLevelZeroTilesX : nx, 
	            numberOfLevelZeroTilesY : ny
	        });
	
	        // defines the distance at which the data appears
	        that._levelZeroMaximumError = geodesic.surfaceDistance * 0.25 / (65 * ny) * that._loadDistance;
	        that._workerPool = new WorkerPool(4, 'js/createWfsGeometry.js');
	        that._loadedBoxes = [];
	        that._cachedPrimitives = {};
	        that._colorFunction = function(properties){
	            return new Cesium.Color(1.0,1.0,1.0,1.0);
	        };
	
	        var ws = [extent.west * DEGREES_PER_RADIAN, extent.south * DEGREES_PER_RADIAN];
	        var en = [extent.east * DEGREES_PER_RADIAN, extent.north * DEGREES_PER_RADIAN];
	        var wn = [extent.west * DEGREES_PER_RADIAN, extent.north * DEGREES_PER_RADIAN];
	        var es = [extent.east * DEGREES_PER_RADIAN, extent.south * DEGREES_PER_RADIAN];
	        ws = proj4('EPSG:4326',that._srs).forward(ws);
	        en = proj4('EPSG:4326',that._srs).forward(en);
	        wn = proj4('EPSG:4326',that._srs).forward(wn);
	        es = proj4('EPSG:4326',that._srs).forward(es);
	        that._nativeExtent = [ws[0] < wn[0] ? ws[0] : wn[0],
	                              ws[1] < es[1] ? ws[1] : es[1],
	                              es[0] > en[0] ? es[0] : en[0],
	                              wn[1] > en[1] ? wn[1] : en[1]];
	        that._nx = nx * 2;
	        that._ny = ny * 2;
	
	        that._tileLoaded = 0;
	        that._tilePending = 0;
	        that._ready = false;

			if( that._onGetReady !== null ){
				that._onGetReady( that._nativeExtent, extent, nx, ny );
			}	


        } catch (err){
            console.error(err);
        }
    });

};

WfsTileProvider.prototype.beginUpdate = function(context, frameState, commandList) {
	if( this._beginUpdate !== null ){
		this._beginUpdate(context, frameState, commandList);
	}
};

WfsTileProvider.prototype.endUpdate = function(context, frameState, commandList) {
	if( this._endUpdate !== null ){
		this._endUpdate(context, frameState, commandList);
	}
};

WfsTileProvider.prototype.getLevelMaximumGeometricError = function(level) {
    return this._levelZeroMaximumError / (1 << level);
};


WfsTileProvider.prototype.loadTile = function(context, frameState, tile) {
    var that = this;
    
    if (tile.state === Cesium.QuadtreeTileLoadState.START) {
    
    	tile.data = {
            primitive: undefined,
            freeResources: function() {
                
            	if ( Cesium.defined( this.primitive ) ) {
            		console.log('I need to be destroyed')
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

        if( this._onLoadTile !== null ){
        	this._onLoadTile( context, frameState, tile, tileSizeMeters );
        }
        
        if( tile.level === 1 ) {
            this.prepareTile(tile, context, frameState);
        } else if(tile.level === 0) {
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
            tile.renderable = true;
        } else {
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
            tile.renderable = false;
        }

    }
};

WfsTileProvider.prototype.computeTileVisibility = function(tile, frameState, occluders) {
    var boundingSphere;
    if (frameState.mode === Cesium.SceneMode.SCENE3D) {
        boundingSphere = tile.data.boundingSphere3D;
    } else {
        boundingSphere = tile.data.boundingSphere2D;
    }
	var iv = frameState.cullingVolume.computeVisibility(boundingSphere);
	if( this._onComputeTileVisibility !== null ){
		this._onComputeTileVisibility( tile, iv );
	}	
    return iv;
};

WfsTileProvider.prototype.showTileThisFrame = function(tile, context, frameState, commandList) {
    tile.data.primitive.update(context, frameState, commandList);
};

WfsTileProvider.prototype.computeDistanceToTile = function(tile, frameState) {
    var boundingSphere;
    if (frameState.mode === Cesium.SceneMode.SCENE3D) {
        boundingSphere = tile.data.boundingSphere3D;
    } else {
        boundingSphere = tile.data.boundingSphere2D;
    }
    var dd = Math.max(0.0, Cesium.Cartesian3.magnitude(Cesium.Cartesian3.subtract(boundingSphere.center, frameState.camera.positionWC, subtractScratch)) - boundingSphere.radius);
    
    if( this._onComputeDistanceToTile !== null ){
    	this._onComputeDistanceToTile( tile, dd );
    }
    
    return dd; 
};

WfsTileProvider.prototype.isDestroyed = function() {
    return false;
};

WfsTileProvider.prototype.destroy = function() {
    return Cesium.destroyObject(this);
};

WfsTileProvider.geometryFromArrays = function(data){
	console.log('X5-I');

    WfsTileProvider.TRICOUNT += data.position.length / 9;
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

	console.log('X5-O');

    return geom;
};

// static
WfsTileProvider.computeMatrix = function(localPtList, cartesianPtList) {
    var pt1local = localPtList[0];
    var pt2local = localPtList[1];
    var pt3local = localPtList[2];

    var pt1cart = cartesianPtList[0];
    var pt2cart = cartesianPtList[1];
    var pt3cart = cartesianPtList[2];

    // translation lambert -> lambert originie en pt1
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

WfsTileProvider.prototype.prepareTile = function(tile, context, frameState) {
	
	if( this._onPrepareTile !== null ){
		this._onPrepareTile( tile );
	}
	
    var key = tile.x + ";" +  tile.y;
    if( key in this._cachedPrimitives ) {
        var cached = this._cachedPrimitives[key];
        for(var p = 0; p < cached.length; p++) {
            tile.data.primitive.add(cached[p].primitive);
        }
        tile.data.primitive.update(context, frameState, []);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        return;
    }

    this.addPendingTile();
    this._cachedPrimitives[key] = [];
    WfsTileProvider.STATS[key] = {};
    WfsTileProvider.STATS[key].start = (new Date()).getTime();
    tile.state = Cesium.QuadtreeTileLoadState.LOADING;
    var bboxll = [DEGREES_PER_RADIAN * tile.rectangle.west,
                    DEGREES_PER_RADIAN * tile.rectangle.south,
                    DEGREES_PER_RADIAN * tile.rectangle.east,
                    DEGREES_PER_RADIAN * tile.rectangle.north];
    var ws = [bboxll[0], bboxll[1]];
    var wn = [bboxll[0], bboxll[3]];
    var en = [bboxll[2], bboxll[3]];
    var es = [bboxll[2], bboxll[1]];
    ws = proj4('EPSG:4326',this._srs).forward(ws);
    en = proj4('EPSG:4326',this._srs).forward(en);
    wn = proj4('EPSG:4326',this._srs).forward(wn);
    es = proj4('EPSG:4326',this._srs).forward(es);

    // matrix
    // triangle tile
    var pt1local = new Cesium.Cartesian3(ws[0], ws[1], 0);
    var pt2local = new Cesium.Cartesian3(es[0], es[1], 0);
    var pt3local = new Cesium.Cartesian3(wn[0], wn[1], 0);
    var pt4local = new Cesium.Cartesian3(en[0], en[1], 0);

    var localArray = [pt1local, pt2local, pt3local];
    var localArray2 = [pt4local, pt2local, pt3local];

    var pt1cart = new Cesium.Cartesian3.fromDegrees(bboxll[0], bboxll[1], this._zOffset);
    var pt2cart = new Cesium.Cartesian3.fromDegrees(bboxll[2], bboxll[1], this._zOffset);
    var pt3cart = new Cesium.Cartesian3.fromDegrees(bboxll[0], bboxll[3], this._zOffset);
    var pt4cart = new Cesium.Cartesian3.fromDegrees(bboxll[2], bboxll[3], this._zOffset);

    var cartesianArray = [pt1cart, pt2cart, pt3cart];
    var cartesianArray2 = [pt4cart, pt2cart, pt3cart];

    var m = WfsTileProvider.computeMatrix(localArray, cartesianArray);
    var m2 = WfsTileProvider.computeMatrix(localArray2, cartesianArray2);

    var x0,x1,y0,y1;
    var lx = this._nativeExtent[2] - this._nativeExtent[0];
    var ly = this._nativeExtent[3] - this._nativeExtent[1];
    x0 = tile.x * lx / this._nx + this._nativeExtent[0];
    x1 = (tile.x + 1) * lx / this._nx + this._nativeExtent[0];
    y0 = (this._ny - tile.y - 1) * ly / this._ny + this._nativeExtent[1];
    y1 = (this._ny - tile.y) * ly / this._ny + this._nativeExtent[1];

    var bbox = [x0,y0 < y1 ? y0 : y1 ,x1, y0 < y1 ? y1 : y0];

    WfsTileProvider.STATS[key].matrix = (new Date()).getTime();

    
    if( this._beforeLoadTile !== null ){
    	this._beforeLoadTile( tile, bboxll );
    }
    
    // grid display
    if( this._debugGrid == true ) {

    	// **************************************************************
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
    	// **************************************************************
        
    	// **************************************************************
        var q1 = new Cesium.Cartesian3.fromRadians(tile.rectangle.west, tile.rectangle.south, 500);
        var q2 = new Cesium.Cartesian3.fromRadians(tile.rectangle.west, tile.rectangle.north, 500);
        var q3 = new Cesium.Cartesian3.fromRadians(tile.rectangle.east, tile.rectangle.north, 500);
        var q4 = new Cesium.Cartesian3.fromRadians(tile.rectangle.east, tile.rectangle.south, 500);
        var bboxPL2 = [q1, q2, q3, q4, q1];
        
        if( this._drawDebugPolyLine !== null ) {
        	this._drawDebugPolyLine( bboxPL, bboxPL2 );
        } else {
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
    	// **************************************************************
        
    }

    if( this._debugPoints == true ) {
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

        for(var debug_pt = 0; debug_pt < points_srs.length; debug_pt++) {
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

    var request = this._url+
            '?SERVICE=WFS'+
            '&VERSION=1.0.0'+
            '&REQUEST=GetFeature'+
            '&outputFormat=JSON'+
            '&typeName='+this._layerName+
            '&srsName='+this._srs+
            '&BBOX='+bbox.join(',');

    if( this._requestFeature !== null ){
    	this._requestFeature( request );
    } 
    
    this._workerPool.enqueueJob({ request : request }, function( w ){
        
    	console.log("ENQ-JOB");
    	
    	if (tile.data.primitive === undefined){
            if( w.data.geom !== undefined ) return;   // TODO : cancel request in stead of waiting for its completion
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
            var diag = [es[0] - wn[0], es[1] - wn[1]];
            var posCenter = new Cesium.Cartesian3(w.data.geom.bbox[0], w.data.geom.bbox[1], 300);
            Cesium.Matrix4.multiplyByPoint(m, posCenter, posCenter);
            var vectP = [w.data.geom.bsphere_center[0] - wn[0], w.data.geom.bsphere_center[1] - wn[1]];
            
            if(diag[0] * vectP[1] - diag[1] * vectP[0] < 0) {
                transformationMatrix = m;
            }  else {
                transformationMatrix = m2;
            }
            
            var idx = geomArray.length;
            var geomProperties = JSON.parse(w.data.geom.properties);
            geomProperties.tileX = tile.x;
            geomProperties.tileY = tile.y;

            geomProperties.color = that._colorFunction(geomProperties);
            w.data.geom.color = geomProperties.color;
            properties[geomProperties.gid] = geomProperties;
            var attributes = {color : new Cesium.ColorGeometryInstanceAttribute(geomProperties.color.red, geomProperties.color.green, geomProperties.color.blue)};
            
            
            geomArray[idx] = new Cesium.GeometryInstance({
                modelMatrix : transformationMatrix,
                geometry : WfsTileProvider.geometryFromArrays(w.data.geom),
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
                vertexShaderSource : WfsTileProvider._vertexShader,
                fragmentShaderSource : WfsTileProvider._fragmentShader
            }),
            asynchronous : false
        });
        
        prim.properties = properties;

        if( this._primitiveLoaded !== null ){
        	this._primitiveLoaded( prim );
        }
        
        that._cachedPrimitives[key].push( { primitive:prim } );
        tile.data.primitive.add(prim);

        that._workerPool.releaseWorker(w.data.workerId);
        tile.data.primitive.update(context, frameState, []);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        that.addLoadedTile();
        WfsTileProvider.STATS[key].geom_stats = w.data.stats;
        WfsTileProvider.STATS[key].end = (new Date()).getTime();
        
    });
    
};

/* Return a list of 2D boxes (long lat in degrees) that are not already loaded
 * for a considered region of interest
 */
WfsTileProvider.prototype.boxes = function(bbox){
	console.log('X8-I');
	
	
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
	
	console.log('X8-O');

    return {needed:neededBoxes, available:availableBoxes};
};

/* Cleanup the list of loaded boxes
 */
WfsTileProvider.prototype.boxLoaded = function(bbox){
	console.log('X9-I');

    var loadedBoxes = this._loadedBoxes;
    for (i=loadedBoxes.length-1; i>=0; i--){
        if (covers(bbox, loadedBoxes[i])) loadedBoxes.splice(i, 1);
    }
    loadedBoxes.push(bbox);
    if( this._boxLoaded !== null ){
    	this._boxLoaded( bbox );
    }
	console.log('X9-O');
	
};

WfsTileProvider.prototype.setColorFunction = function(colorFunction){
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

WfsTileProvider.prototype.addPendingTile = function () {
    this._tilePending++;
    this.updateProgress();
};

WfsTileProvider.prototype.addLoadedTile = function () {
    this._tilePending--;
    this._tileLoaded++;
    this.updateProgress();
};

WfsTileProvider.prototype.removePendingTile = function () {
    this._tilePending--;
    this.updateProgress();
};

WfsTileProvider.prototype.updateProgress = function () {
    if( this._updateProgress !== null  ){
    	var tot = this._tilePending + this._tileLoaded;
    	this._updateProgress( this._tilePending, this._tileLoaded , tot );
    }
};
