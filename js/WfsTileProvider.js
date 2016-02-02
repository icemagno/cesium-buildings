var TileProvider = require('./TileProvider.js');

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
 * @param [options.properties=.] : list of semantic properties to load along the geometry
 * @param options.workerPool: the worker pool in which the requests will be queued
 */
var WfsGeometryProvider = function(options){
    TileProvider.call(this, options);
};

WfsGeometryProvider.prototype = Object.create(TileProvider.prototype);

WfsGeometryProvider
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
WfsGeometryProvider
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


WfsGeometryProvider.geometryFromArrays = function(data){
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


WfsGeometryProvider.prototype.loadGeometry = function(tile) {
    var key = tile.x + ";" +  tile.y + ";" + tile.level;
    var geomArray = [];
    var properties = {};

    var tileId = (tile.level - 1) + "/" + (-1 + this._ny * Math.pow(2, tile.level - 1) - tile.y) + "/" + tile.x;
    var request = this._url + "?city=" + this._layerName + "&format=GeoJSON&query=getGeometry&tile=" + tileId;
    if(this._propertiesList.length !== 0) {
        request += "&attributes=";
        for(var i in this._propertiesList) {
            request += this._propertiesList[i] + ",";
        }
        request = request.slice(0,-1);
    }


    var tileY = -1 + this._ny * Math.pow(2, tile.level - 1) - tile.y;
    var xOffset = this._nativeExtent[0] + tile.x * (this._tileSize / Math.pow(2, tile.level - 1));
    var yOffset = this._nativeExtent[1] + tileY * (this._tileSize / Math.pow(2, tile.level - 1));
    var offsetTranslation = new Cesium.Cartesian3(xOffset, yOffset, 0);
    var offsetMatrix = new Cesium.Matrix4();
    Cesium.Matrix4.fromTranslation(offsetTranslation, offsetMatrix);

    var that = this;
    this._workerPool.enqueueJob({request: request, worker: "createWfsGeometry"}, function(w){
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
                geometry : WfsGeometryProvider.geometryFromArrays(w.data.geom),
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
                vertexShaderSource : WfsGeometryProvider._vertexShader,
                fragmentShaderSource : WfsGeometryProvider._fragmentShader
            }),
            asynchronous : false
        });
        prim.properties = properties;
        that._cachedPrimitives[key].push({/*bbox:w.data.geom.bbox,*/ primitive:prim});
        tile.data.primitive.add(prim);

        // Adding new available tiles
        tiles = w.data.tiles;
        for(var i = 0; i < tiles.length; i++) {
            that._availableTiles[tiles[i].id] = tiles[i].bbox;
        }
        delete that._loadingPrimitives[w.data.workerId];
        that._loadedTiles[tileId] = tile;

        that._workerPool.releaseWorker(w.data.workerId);
        //tile.data.primitive.update(frameState);
        tile.state = Cesium.QuadtreeTileLoadState.DONE;
        tile.renderable = true;
        that.addLoadedTile();
    });       
};

module.exports = WfsGeometryProvider;