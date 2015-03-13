/* Create a Cesium Geometry from a structure
 * returned by createWfsGeometry worker
 */
function geometryFromArrays(data){
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
}

/* The tile will be empty if the tile size (north->south) is below minSize or above maxsize
 */
function WfsTileProvider(url, layerName, textureBaseUrl, minSizeMeters, maxSizeMeters){
    this._quadtree = undefined;
    this._tilingScheme = new Cesium.GeographicTilingScheme();
    this._errorEvent = new Cesium.Event();
    this._levelZeroMaximumError = Cesium.QuadtreeTileProvider.computeDefaultLevelZeroMaximumGeometricError(this._tilingScheme);

    this._minSizeMeters = minSizeMeters;
    this._maxSizeMeters = maxSizeMeters;

    this._url = url;
    this._layerName = layerName;
    this._textureBaseUrl = textureBaseUrl+'/';
    this._workQueue = new WorkQueue('js/createWfsGeometry.js');
    this._loadedBoxes = [];
    this._cachedPrimitives = [];
}

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
            return true;
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

WfsTileProvider.prototype.beginUpdate = function(context, frameState, commandList) {};

WfsTileProvider.prototype.endUpdate = function(context, frameState, commandList) {};

WfsTileProvider.prototype.getLevelMaximumGeometricError = function(level) {
    return this._levelZeroMaximumError / (1 << level);
};

var DEGREES_PER_RADIAN = 180.0 / Math.PI;
var RADIAN_PER_DEGREEE = 1 / DEGREES_PER_RADIAN;

WfsTileProvider.prototype.placeHolder = function(tile, red) {
    var color = Cesium.Color.fromBytes(0, 0, 255, 255);
    if (red){
        color = Cesium.Color.fromBytes(255, 0, 0, 255);
    }
    tile.data.primitive.add( new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
            geometry: new Cesium.RectangleOutlineGeometry({
                rectangle: tile.rectangle
            }),
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
            }
        }),
        appearance: new Cesium.PerInstanceColorAppearance({
            flat: true
        })
    }));
};

WfsTileProvider.prototype.loadTile = function(context, frameState, tile) {
    var that = this;
    if (tile.state === Cesium.QuadtreeTileLoadState.START) {
        tile.data = {
            primitive: new Cesium.PrimitiveCollection(),
            freeResources: function() {
                if (Cesium.defined(this.primitive)) {
                    //this.primitive.destroy();
                    this.primitive = undefined;
                }
            }
        };

        var earthRadius = 6371000;
        var tileSizeMeters = Math.abs(earthRadius*(tile.rectangle.south - tile.rectangle.north));

        //tile.data.primitive = new Cesium.PrimitiveCollection();
        tile.data.boundingSphere3D = Cesium.BoundingSphere.fromRectangle3D(tile.rectangle);
        tile.data.boundingSphere2D = Cesium.BoundingSphere.fromRectangle2D(tile.rectangle, frameState.mapProjection);
        Cesium.Cartesian3.fromElements(tile.data.boundingSphere2D.center.z, 
                                       tile.data.boundingSphere2D.center.x, 
                                       tile.data.boundingSphere2D.center.y, 
                                       tile.data.boundingSphere2D.center);

        if (this._minSizeMeters < tileSizeMeters && tileSizeMeters < this._maxSizeMeters) {
            //this.placeHolder(tile);
            this.prepareTile(tile, context, frameState);

        } else {
            //this.placeHolder(tile);
            //tile.data.primitive.update(context, frameState, []);
            tile.state = Cesium.QuadtreeTileLoadState.DONE;
            tile.renderable = true;
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
    return frameState.cullingVolume.computeVisibility(boundingSphere);
};

WfsTileProvider.prototype.showTileThisFrame = function(tile, context, frameState, commandList) {
    tile.data.primitive.update(context, frameState, commandList);
};

var subtractScratch = new Cesium.Cartesian3();

WfsTileProvider.prototype.computeDistanceToTile = function(tile, frameState) {
    var boundingSphere;
    if (frameState.mode === Cesium.SceneMode.SCENE3D) {
        boundingSphere = tile.data.boundingSphere3D;
    } else {
        boundingSphere = tile.data.boundingSphere2D;
    }
    return Math.max(0.0, Cesium.Cartesian3.magnitude(Cesium.Cartesian3.subtract(boundingSphere.center, frameState.camera.positionWC, subtractScratch)) - boundingSphere.radius);
};

WfsTileProvider.prototype.isDestroyed = function() {
    return false;
};

WfsTileProvider.prototype.destroy = function() {
    return Cesium.destroyObject(this);
};

WfsTileProvider.prototype.prepareTile = function(tile, context, frameState){
    tile.state = Cesium.QuadtreeTileLoadState.LOADING;

    var bbox = [DEGREES_PER_RADIAN * tile.rectangle.west,
                DEGREES_PER_RADIAN * tile.rectangle.south,
                DEGREES_PER_RADIAN * tile.rectangle.east,
                DEGREES_PER_RADIAN * tile.rectangle.north];
    var boxes = this.boxes(bbox);
    if (boxes.available.length){
        // get cached primitives
        var cached = this._cachedPrimitives;
        for (var p=0; p<cached.length; p++){
            if (inTile(bbox, cached[p].bbox)){
                tile.data.primitive.add(cached[p].primitive);
            }
        }
    }

    var nbOfLoadeBoxed = 0;
    var that = this;
    for (var b=0; b<boxes.needed.length; b++){
        var request = this._url+
                '?SERVICE=WFS'+
                '&VERSION=1.0.0'+
                '&REQUEST=GetFeature'+
                '&outputFormat=JSON'+
                '&typeName='+this._layerName+
                '&srsName=EPSG:4326'+
                '&BBOX='+boxes.needed[b].join(',');

        this._workQueue.addTask(request, function(w){
            if (typeof tile.data.primitive == 'undefined'){
                // tile suppressed while we waited for reply
                // receive messages from worker until done
                tile.state = Cesium.QuadtreeTileLoadState.DONE;
                tile.renderable = false;
                return w.data != 'done';
            }
            if (w.data != 'done'){
                var props = JSON.parse(w.data.properties);

                var mat = new Cesium.Material({
                    fabric : {
                        type : 'DiffuseMap',
                        //components : {
                        //    diffuse :  w.data.gid%2 ? 'vec3(.7,.3,0)' : 'vec3(1,.5,0)',
                        //    specular : '0.1'
                        //}
                        uniforms : {
                            image : that._textureBaseUrl+w.data.texture
                        }
                        //,
                        //components : {
                        //    diffuse : 'texture2D(image, materialInput.st).rgb',
                        //    specular : '0.1'
                        //}
                    }
                });
                var prim = new Cesium.Primitive({
                    geometryInstances: new Cesium.GeometryInstance({
                        geometry: geometryFromArrays(w.data)
                    }),
                    //releaseGeometryInstances: false,
                    appearance : new Cesium.MaterialAppearance({
                        material : mat,
                        faceForward : false,
                        closed : false
                      }),
                    asynchronous : false
                });
                prim.gid = w.data.gid;
                prim.properties = props;
                that._cachedPrimitives.push({bbox:w.data.bbox, primitive:prim});
                tile.data.primitive.add(prim);
                return true;
            }
            ++nbOfLoadeBoxed;
            if (nbOfLoadeBoxed == boxes.needed.length){
                tile.data.primitive.update(context, frameState, []);
                tile.state = Cesium.QuadtreeTileLoadState.DONE;
                tile.renderable = true;
                that.boxLoaded(bbox);
            }
            return false;
        });
    }

    if (!boxes.needed.length){
        tile.data.primitive.update(context, frameState, []);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        this.boxLoaded(bbox);
    }


};

/* Return a list of 2D boxes (long lat in degrees) that are not already loaded
 * for a considered region of interest
 */
WfsTileProvider.prototype.boxes = function(bbox){
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
WfsTileProvider.prototype.boxLoaded = function(bbox){
    var loadedBoxes = this._loadedBoxes;
    for (i=loadedBoxes.length-1; i>=0; i--){
        if (covers(bbox, loadedBoxes[i])) loadedBoxes.splice(i, 1);
    }
    loadedBoxes.push(bbox);
};


