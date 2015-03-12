/* This worker thread receives messages containing urls of wfs data
 * it will send a message for each loaded feature:
 * {originUrl:url, properties, position, st, indices, normals, binormals, tangent}
 * the properties are a json string that can be parsed by the caller
 * once the url features have been exhausted, the folowing message is sent:
 * 'done'
 */

//importScripts('../../cesium/Cesium.js');
importScripts('../Source/BboxLib.js');
//importScripts('//cdnjs.cloudflare.com/ajax/libs/jquery/2.1.1/jquery.min.js')

// simple url loader in pure javascript
function load(url, callback) {
    var xhr;

    if (typeof XMLHttpRequest !== 'undefined') xhr = new XMLHttpRequest();
    else {
        var versions = ["MSXML2.XmlHttp.5.0",
            "MSXML2.XmlHttp.4.0",
            "MSXML2.XmlHttp.3.0",
            "MSXML2.XmlHttp.2.0",
            "Microsoft.XmlHttp"
        ];

        for (var i = 0, len = versions.length; i < len; i++) {
            try {
                xhr = new ActiveXObject(versions[i]);
                break;
            } catch (e) {}
        } // end for
    }
    xhr.onreadystatechange = ensureReadiness;

    function ensureReadiness() {
        if (xhr.readyState < 4) {
            return;
        }
        if (xhr.status !== 200) {
            return;
        }

        // all is well
        if (xhr.readyState === 4) {
            callback(xhr);
        }
    }
    xhr.open('GET', url, true);
    xhr.send('');
}

var wgs84RadiiSquared = [6378137.0 * 6378137.0, 6378137.0 * 6378137.0, 6356752.3142451793 * 6356752.3142451793];
var DEGREES_PER_RADIAN = 180.0 / Math.PI;
var RADIAN_PER_DEGREEE = 1 / DEGREES_PER_RADIAN;

function cartesianFromDregree(longitude, latitude, height) {

    var lat = latitude*RADIAN_PER_DEGREEE;
    var lon = longitude*RADIAN_PER_DEGREEE;
    var cosLatitude = Math.cos(lat);
    var scratchN = [cosLatitude * Math.cos(lon),
                    cosLatitude * Math.sin(lon),
                    Math.sin(lat)];
    var magN = Math.sqrt( scratchN[0]*scratchN[0] +
                          scratchN[1]*scratchN[1] +
                          scratchN[2]*scratchN[2]);
    scratchN[0] /= magN;
    scratchN[1] /= magN;
    scratchN[2] /= magN;

    var scratchK = [wgs84RadiiSquared[0]*scratchN[0],
                    wgs84RadiiSquared[1]*scratchN[1],
                    wgs84RadiiSquared[2]*scratchN[2]];

    var gamma = Math.sqrt(scratchN[0]*scratchK[0] +
                          scratchN[1]*scratchK[1] +
                          scratchN[2]*scratchK[2]);

    scratchK[0] /= gamma;
    scratchK[1] /= gamma;
    scratchK[2] /= gamma;
    scratchN[0] *= height;
    scratchN[1] *= height;
    scratchN[2] *= height;
    return [scratchK[0]+scratchN[0],
            scratchK[1]+scratchN[1],
            scratchK[2]+scratchN[2]];
}

/*
        var load = function(that, geoJson, sourceUri, options) {

            var primCol = new Cesium.PrimitiveCollection();
            var texRe = /\((.*),"(.*)"\)/;

            //console.log("loading features", geoJson.features.length);
            for (var f = 0; f < geoJson.features.length; f++) {
                var texP = texRe.exec(geoJson.features[f].properties.tex);
                var arrJson = texP[2].replace(/{/g, "[").replace(/}/g, "]")
                var st = JSON.parse(arrJson);
                var coord = geoJson.features[f].geometry.coordinates
                var geom = new WfsGeometry({
                    position: coord,
                    st: st
                });

                var mat = new Cesium.Material({
                    fabric: {
                        type: 'DiffuseMap',
                        uniforms: {
                            image: texture_dir + texP[1]
                        }
                    }
                });
                primCol.add(new Cesium.Primitive({
                    geometryInstances: new Cesium.GeometryInstance({
                        geometry: geom
                    }),
                    appearance: new Cesium.MaterialAppearance({
                        material: mat, //Cesium.Material.fromType('Color'),
                        color: Cesium.Color.fromBytes(255, 0, 0, 255),
                        faceForward: true
                    }),
                    asynchronous: false
                }));
            }


            if (primCol.length) {
                options.tile.data.primitive = primCol;
            } else {
                this.placeHolder(options.tile)
            }

            options.tile.data.boundingSphere3D = Cesium.BoundingSphere.fromRectangle3D(options.tile.rectangle);
            options.tile.data.boundingSphere2D = Cesium.BoundingSphere.fromRectangle2D(options.tile.rectangle, frameState.mapProjection);
            Cesium.Cartesian3.fromElements(options.tile.data.boundingSphere2D.center.z, options.tile.data.boundingSphere2D.center.x, options.tile.data.boundingSphere2D.center.y, options.tile.data.boundingSphere2D.center);
            options.tile.data.primitive.update(options.context, options.frameState, []);
            options.tile.state = Cesium.QuadtreeTileLoadState.DONE;
            options.tile.renderable = true;
        };
*/

function dot(u,v){
    return u[0]*v[0] + u[1]*v[1] + u[2]*v[2];
}

function plus(u,v){
    return [u[0]+v[0], u[1]+v[1], u[2]+v[2]];
}

function minus(u,v){
    return [u[0]-v[0], u[1]-v[1], u[2]-v[2]];
}

function cross(u,v){
    return [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]];
}

function normsq(u){
    return dot(u,u);
}

function norm(u){
    return Math.sqrt(dot(u,u));
}

function mult(u, x){
    return [u[0]*x, u[1]*x, u[2]*x];
}

function testGeometry(){
    var i;
    var A = cartesianFromDregree(4.84, 45.74, 50); 
    var B = cartesianFromDregree(4.86, 45.74, 50); 
    var C = cartesianFromDregree(4.86, 45.76, 50); 
    var D = cartesianFromDregree(4.84, 45.76, 50); 

    //var A = [4443197.097834845, 376229.67805021134, 4545161.541107168];
    //var B = [4443065.498209954, 377780.6234709375, 4545161.541107168];
    //var C = [4441478.922403821, 377645.72165653337, 4546712.691703641];
    //var D = [4441610.475035757, 376095.33006344765, 4546712.691703641];

    var pos =[A[0], A[1], A[2],
              B[0], B[1], B[2],
              C[0], C[1], C[2],
              D[0], D[1], D[2],
             ];
    var position = new  Float64Array(pos.length);
    for (i = 0; i < position.length; i++) position[i] = pos[i];
    
    var ind = [0, 1, 2, 0, 2, 3];
    var indices = new Uint16Array(6);
    for (i = 0; i < 6; i++) indices[i] = ind[i];

    var normal = new  Float32Array(pos.length);
    for (i = 0; i < normal.length; i++) normal[i] = (i+1)%3 ? 0 : 1;

    var binormal = new Float32Array(pos.length);
    for (i = 0; i < binormal.length; i++) binormal[i] = (i+2)%3 ? 0 : 1;

    var tangent = new Float32Array(pos.length);
    for (i = 0; i < tangent.length; i++) tangent[i] = (i+3)%3 ? 0 : 1;

    var tex = [0,0,
              1,0,
              1,1,
              0,1];
    var st = new  Float32Array(tex.length);
    for (i = 0; i < st.length; i++) st[i] = tex[i];

    var center = new Float32Array(3);
    center[0] = 0.5*(pos[0]+ pos[3]);
    center[1] = 0.5*(pos[1]+ pos[7]);
    center[2] = pos[2];
    radius = 0.5*Math.abs(pos[3] - pos[0]);
    return {
        indices:indices,
        position:position, 
        normal:normal, 
        tangent:tangent, 
        binormal:binormal, 
        st:st, 
        bsphere_center:center, 
        bsphere_radius:radius
    }
}

function geomFromWfsTin(coord, textureCoord){
    var t,v,i;
    var U, V, N, Utex, Vtex;
    var nrm;
    var indices = new Uint16Array(3*coord.length);// triangle soup 
    var position = new  Float64Array(3*indices.length);
    var normal = new Float32Array(position.length);
    var tangent = new Float32Array(position.length);
    var binormal = new Float32Array(position.length);
    var st = new Float32Array((position.length/3)*2);
    var centroid = [0,0,0];
    var radius = 0;
    var center = new Float32Array(3);

    for (i=0; i<indices.length; i++) indices[i] = i;

    // set position
    for (i=0, t=0; t<coord.length; t++){
        for (v = 0; v < 3; v++, i+=3){
            var p = cartesianFromDregree(coord[t][0][v][0], 
                                         coord[t][0][v][1], 
                                         coord[t][0][v][2]);
            position[i] = p[0];
            position[i+1] = p[1];
            position[i+2] = p[2];
            centroid = plus(centroid, p);
        }
    }
    centroid = mult(centroid, 3.0/position.length);
    for (v=0; v<position.length; v+=3){
        radius = Math.max(radius, normsq(minus(
                        [position[v], position[v+1], position[v+2]], centroid)));
    }
    radius = Math.sqrt(radius);
    for (i=0; i<3; i++) center[i] = centroid[i];


    // compute normals
    for (t=0; t<position.length; t+=9){
        U = minus([position[t+3], position[t+4],position[t+5]], 
                  [position[t  ], position[t+1],position[t+2]]);
        V = minus([position[t+6], position[t+7],position[t+8]], 
                  [position[t  ], position[t+1],position[t+2]]);
        N = cross(U, V);
        N = mult(N, 1.0/norm(N));
        for (i=0; i<9; i++) normal[t+i] = N[i%3];
    } 

    // set st
    for (i=0, t=0; t<textureCoord.length; t+=4, i+=6){ // 4 vtx per triangles
        st[i] = textureCoord[t][0];
        st[i+1] = textureCoord[t][1];
        st[i+2] = textureCoord[t+1][0];
        st[i+3] = textureCoord[t+1][1];
        st[i+4] = textureCoord[t+2][0];
        st[i+5] = textureCoord[t+2][1];
    }

    // compute tangent
    for (i=0, t=0, v=0; t<position.length; t+=9, v+=6, i+=9){
        // find the coord u and v in texture space
        // project the natural base (s, t) on the base (u, v) in 
        // tangent space
        // now we use those coord in 3D space 
        // and we normalize (maybe orthogonalize while preserving normal)
        // Based on <a href="http://www.terathon.com/code/tangent.html">Computing Tangent Space Basis Vectors
        U = minus([position[t+3], position[t+4],position[t+5]], 
                  [position[t  ], position[t+1],position[t+2]]);
        V = minus([position[t+6], position[t+7],position[t+8]], 
                  [position[t  ], position[t+1],position[t+2]]);
        Utex = [st[v+2] - st[v], st[v+3] -st[v+1]];
        Vtex = [st[v+4] - st[v], st[v+5] -st[v+1]];

        var r = 1.0 / (Utex[0] * Vtex[1] - Vtex[0] * Utex[1]);

        var tan1 = [(Vtex[1] * U[0] - Utex[1] * V[0]) * r, 
                    (Vtex[1] * U[1] - Utex[1] * V[1]) * r,
                    (Vtex[1] * U[2] - Utex[1] * V[2]) * r];
        var tan2 = [(Utex[0] * V[0] - Vtex[0] * U[0]) * r, 
                    (Utex[0] * V[1] - Vtex[0] * U[1]) * r,
                    (Utex[0] * V[2] - Vtex[0] * U[2]) * r];
        tan1 = mult(tan1, 1.0/norm(tan1));
        tan2 = mult(tan2, 1.0/norm(tan2));

        for (i=0; i<9; i++){ 
            tangent[t+i] = tan1[i%3];
            binormal[t+i] = tan2[i%3];
        }
    }

    return {
        indices:indices,
        position:position, 
        normal:normal, 
        tangent:tangent, 
        binormal:binormal, 
        st:st, 
        bsphere_center:center, 
        bsphere_radius:radius
    }
}

function geomCopy(geom){
    return {
        indices:new Uint16Array(geom.indices),
        position:new Float64Array(geom.position), 
        normal:new Float32Array(geom.normal), 
        tangent:new Float32Array(geom.tangent), 
        binormal:new Float32Array(geom.binormal), 
        st:new Float32Array(geom.st), 
        bsphere_center:new Float32Array(geom.center), 
        bsphere_radius:geom.radius,
        bbox:new Array(geom.bbox),
        gid:geom.gid
    };
}

function geomFromWfs(type, coord, textureCoord){
    if (type != 'MultiPolygon') throw "Unhandled geometry type '"+type+"'";

    if (type == 'MultiPolygon'){
        return geomFromWfsTin(coord, textureCoord);
    } else {
        throw "Unhandled geometry type '"+type+"'";
    }
}

function GeometryCache(){
    this._tiles = [];
    this._geometries = {};
}

GeometryCache.prototype.get = function(tileBBox){
    var i, j;
    //console.log("we have ", this._tiles.length, " tiles");
    for (i=0; i<this._tiles.length; i++){
        if (covers(this._tiles[i].bbox, tileBBox)){
            //console.log("found tile");
            var geoms = [];
            var gids = this._tiles[i].gids;
            var geometries = this._geometries;
            for (j=0; j<gids.length; j++){
                if( inTile(tileBBox, geometries[gids[j]].bbox)){
                    geoms.push(geomCopy(this._geometries[gids[j]]));
                }
            }
            return geoms;
        }
    }
    return [];
}

GeometryCache.prototype.addEmpty = function(tileBBox){
    for (i=0; i<this._tiles.length; i++){
        if (covers(this._tiles[i].bbox, tileBBox)){ 
            return;
        }
    }
    this._tiles.push({bbox:tileBBox, gids:[]});
}

GeometryCache.prototype.add = function(tileBBox, geom){
    var i;
    for (i=0; i<this._tiles.length; i++){
        if (covers(this._tiles[i].bbox, tileBBox)){
            if (this._tiles[i].gids.indexOf(geom.gid) == -1){
                this._geometries[geom.gid] = geomCopy(geom);
                this._tiles[i].gids.push(geom.gid);
            }
            return;
        }
    }
    
    // create a new tile
    debugger;
    this._geometries[geom.gid] = geomCopy(geom);
    this._tiles.push({bbox:tileBBox, gids:[geom.gid]});
}

var texRe = /\((.*),"(.*)"\)/;

//var geometryCache = new GeometryCache();

onmessage = function(o) {
    var i;
    var param = o.data.replace(/^.*\?/,'').split('&');
    var queries = {}
    for (i=0; i<param.length; i++){
        var kv = param[i].split('=')
        queries[kv[0].toUpperCase()] = kv[1];
    }

    //console.log(o.data);
    var tileBBox = JSON.parse('['+queries['BBOX']+']');
    var extent = [4.84068822860718, 45.7541275024414, 4.86542463302612, 45.7636680603027];
    
    if (!intersects(extent, tileBBox)){
        postMessage('done');
        return;
    }


    load(o.data, function(xhr) {
        var geoJson = JSON.parse(xhr.responseText);
        //console.log("loading features", geoJson.features.length);
        for (var f = 0; f < geoJson.features.length; f++) {
            var bbox = new Float32Array(4);
            //var ctr = new Float32Array(3);
            if (geoJson.features[f].geometry.bbox.length == 6){
                bbox[0] = geoJson.features[f].geometry.bbox[0];
                bbox[1] = geoJson.features[f].geometry.bbox[1];
                bbox[2] = geoJson.features[f].geometry.bbox[3];
                bbox[3] = geoJson.features[f].geometry.bbox[4];

                //var wsb = cartesianFromDregree(geoJson.features[f].geometry.bbox[0],
                //                                geoJson.features[f].geometry.bbox[1],
                //                                geoJson.features[f].geometry.bbox[2]);
                //var ent = cartesianFromDregree(geoJson.features[f].geometry.bbox[3],
                //                                geoJson.features[f].geometry.bbox[4],
                //                                geoJson.features[f].geometry.bbox[5]);
                //console.log(geoJson.features[f].geometry.bbox);
                //ctr[0] = .5*(wsb[0]+ent[0]); 
                //ctr[1] = .5*(wsb[1]+ent[1]); 
                //ctr[1] = .5*(wsb[2]+ent[2]); 

            } else {
                bbox[0] = geoJson.features[f].geometry.bbox[0];
                bbox[1] = geoJson.features[f].geometry.bbox[1];
                bbox[2] = geoJson.features[f].geometry.bbox[2];
                bbox[3] = geoJson.features[f].geometry.bbox[3];
            }

            if (inTile(tileBBox, bbox)){
                var texP = texRe.exec(geoJson.features[f].properties.tex);
                // remove the texture from properties
                delete geoJson.features[f].properties.tex;
                var arrJson = texP[2].replace(/{/g, "[").replace(/}/g, "]");
                var st = JSON.parse(arrJson);
                var coord = geoJson.features[f].geometry.coordinates;
                var type = geoJson.features[f].geometry.type;
                
                //var geom = testGeometry();
                var geom = geomFromWfs(type, coord, st);
                geom.texture = texP[1];
                geom.properties = JSON.stringify(geoJson.features[f].properties);
                geom.bbox = bbox;
                geom.gid = geoJson.features[f].properties.gid;
                //console.log(geom.bsphere_center, ctr);
                //geom.bsphere_center = ctr; //DEBUG



                try {
                postMessage( 
                    geom, 
                    [
                        geom.indices.buffer,
                        geom.position.buffer, 
                        geom.normal.buffer, 
                        geom.tangent.buffer, 
                        geom.binormal.buffer, 
                        geom.st.buffer, 
                        geom.bsphere_center.buffer,
                        geom.bbox.buffer
                    ]
                );
                }catch (e){
                    debugger;
                }
            }
        }

        postMessage('done');
    });
    /*

    postMessage({position:position, normal:normal, tangent:tangent, binormal:binormal, center:center, radius:radius, st:st, indices:indices}, [position.buffer, normal.buffer, tangent.buffer, binormal.buffer, center.buffer, st.buffer, indices.buffer]);
    postMessage('done');
    */
};
