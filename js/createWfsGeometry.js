/* This worker thread receives messages containing urls of wfs data
 *
 * The worker will send a message for each loaded feature.
 * The properties (attributes) are sent as a json string that can be 
 * parsed by the caller.
 *
 * Once the url features have been exhausted, the message 'done' is sent.
 */

importScripts('BboxLib.js');
importScripts('../thirdparty/earcut.js');

/* Simple url loader in pure javascript
 */
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

/* Miscellaneous functions to deal with 3D vectors
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
function normalize(u){
    return mult(u, 1.0/norm(u));
}

/* Converts from wgs84 lat long coordinates to cesium cartesian coordinates
 */

var WGS84_RADII_SQUARED = [6378137.0 * 6378137.0, 6378137.0 * 6378137.0, 6356752.3142451793 * 6356752.3142451793];
var DEGREES_PER_RADIAN = 180.0 / Math.PI;
var RADIAN_PER_DEGREEE = 1 / DEGREES_PER_RADIAN;
var GEOMETRY_STATS = {};

function cartesianFromDregree(longitude, latitude, height) {
    var lat = latitude*RADIAN_PER_DEGREEE;
    var lon = longitude*RADIAN_PER_DEGREEE;
    var cosLatitude = Math.cos(lat);

    var scratchN = normalize([cosLatitude * Math.cos(lon),
                              cosLatitude * Math.sin(lon),
                              Math.sin(lat)]);

    var scratchK = [WGS84_RADII_SQUARED[0]*scratchN[0],
                    WGS84_RADII_SQUARED[1]*scratchN[1],
                    WGS84_RADII_SQUARED[2]*scratchN[2]];

    var gamma = Math.sqrt(dot(scratchN, scratchK));

    scratchK = mult(scratchK, 1.0/gamma);
    scratchN = mult(scratchN, height);
    return plus(scratchK, scratchN);
}

/* Converts a Tin (or, Mutipolygon with only triangles)
 * to typed arrays. The result is a triangle soup.
 * Also compute normals
 *
 * TODO: debug tangent and binormals.
 */ 
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

    // set position and compute 3D centroid
    for (i=0, t=0; t<coord.length; t++){
        for (v = 0; v < 3; v++, i+=3){
            /*var p = cartesianFromDregree(coord[t][0][v][0], 
                                         coord[t][0][v][1], 
                                         coord[t][0][v][2]);
            position[i] = p[0];
            position[i+1] = p[1];
            position[i+2] = p[2];
            plus(centroid, p);*/
            position[i] = coord[t][0][v][0];
            position[i+1] = coord[t][0][v][1];
            position[i+2] = coord[t][0][v][2];
            centroid[0] += position[i];
            centroid[1] += position[i+1];
            centroid[2] += position[i+2];
        }
    }
    centroid = mult(centroid, 3.0/position.length);
    for (i=0; i<3; i++) center[i] = centroid[i];
   
    // compute radius of bounding sphere
    for (v=0; v<position.length; v+=3){
        radius = Math.max(radius, normsq(minus(
                        [position[v], position[v+1], position[v+2]], centroid)));
    }
    radius = Math.sqrt(radius);

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

    // compute tangents an binormals
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
    };
}

/* Converts a PolyhedralSurface
 * to typed arrays. The result is a triangle soup.
 * Also compute normals
 *
 * TODO: debug tangent and binormals.
 */ 
function geomFromWfsPolyhedralSurface(coord, textureCoord){
    var t,v,i,j;
    var U, V, N, Utex, Vtex;
    var nrm;
    var nIndices = 0;
    for (t = 0; t < coord.length; t++) {
        // polygon with n points = n - 2 triangles - 1 because of duplicate first point
        nIndices += coord[t][0].length - 2 - 1;
    }
    var indices = new Uint16Array(3*nIndices);// triangle soup 
    var position = new Float64Array(3*indices.length);
    var normal = new Float32Array(position.length);
    //var tangent = new Float32Array(position.length);
    //var binormal = new Float32Array(position.length);
    var st = new Float32Array((position.length/3)*2);
    var centroid = [0,0,0];
    var radius = 0;
    var center = new Float32Array(3);
    var polygons = [];
    
    var posCount = 0;
    for (i=0; i<indices.length; i++) indices[i] = i;

    // set position and compute 3D centroid
    GEOMETRY_STATS["triangulation_start"][GEOMETRY_STATS["triangulation_start"].length] = (new Date()).getTime();
    for (i=0, t=0; t<coord.length; t++){
        var delta = 0;
        var positionPolygon = [];
        var positionPolygon2D = [];
        
        for (v = 0; v < coord[t][0].length-1; v++){
            var duplicate = false;
            // removing duplicate points
            for(j = 0; j < positionPolygon.length; j+=3) {
                if(coord[t][0][v][0] == positionPolygon[j] &&
                   coord[t][0][v][1] == positionPolygon[j+1] &&
                   coord[t][0][v][2] == positionPolygon[j+2]) {
                    duplicate = true;
                }
            }
            if(duplicate) {
                delta++;
                continue;
            }
            positionPolygon[3 * (v - delta)] = coord[t][0][v][0];
            positionPolygon[3 * (v - delta) + 1] = coord[t][0][v][1];
            positionPolygon[3 * (v - delta) + 2] = coord[t][0][v][2];
        }
        // removing some of the degenerated polyogns (2 points or less)
        if(positionPolygon.length < 9) continue;
        var vect1 = [positionPolygon[3] - positionPolygon[0],
                     positionPolygon[4] - positionPolygon[1],
                     positionPolygon[5] - positionPolygon[2]]
        var vect2 = [positionPolygon[6] - positionPolygon[0],
                     positionPolygon[7] - positionPolygon[1],
                     positionPolygon[8] - positionPolygon[2]]
        var vectProd = [vect1[1] * vect2[2] - vect1[2] * vect2[1],
                        vect1[2] * vect2[0] - vect1[0] * vect2[2],
                        vect1[0] * vect2[1] - vect1[1] * vect2[0]]
        // triangulation of the polygon projected on planes (xy) (zx) or (yz)
        if(Math.abs(vectProd[0]) > Math.abs(vectProd[1]) && Math.abs(vectProd[0]) > Math.abs(vectProd[2])) {
            // (yz) projection
            for(v = 0; 3 * v < positionPolygon.length; v++) {
                positionPolygon2D[2 * v] = positionPolygon[3 * v + 1];
                positionPolygon2D[2 * v + 1] = positionPolygon[3 * v + 2];
            }
        } else if(Math.abs(vectProd[1]) > Math.abs(vectProd[2])) {
            // (zx) projection
            for(v = 0; 3 * v < positionPolygon.length; v++) {
                positionPolygon2D[2 * v] = positionPolygon[3 * v];
                positionPolygon2D[2 * v + 1] = positionPolygon[3 * v + 2];
            }
        } else {
            // (xy) projextion
            for(v = 0; 3 * v < positionPolygon.length; v++) {
                positionPolygon2D[2 * v] = positionPolygon[3 * v];
                positionPolygon2D[2 * v + 1] = positionPolygon[3 * v + 1];
            }
        }
        var triangles = earcut(positionPolygon2D);
        // reordering traingle points for correct normal computation
        for (v = 0; v < triangles.length; v+=3){
            var v1 = triangles[v];
            var v2 = triangles[v+1];
            var v3 = triangles[v+2];
            if(v1 > v2 && v1 > v3) {
                triangles[v+2] = v1;
                if(v2 > v3) {
                    triangles[v] = v3;
                    triangles[v+1] = v2;
                } else {
                    triangles[v] = v2;
                    triangles[v+1] = v3;
                }
            } else if(v1 > v2) {
                triangles[v] = v2;
                triangles[v+1] = v1;
                triangles[v+2] = v3;
            } else if(v1 > v3) {
                triangles[v] = v3;
                triangles[v+1] = v1;
                triangles[v+2] = v2;
            } else {
                if(v2 > v3) {
                    triangles[v] = v1;
                    triangles[v+1] = v3;
                    triangles[v+2] = v2;
                }
            }
        }
        for (v = 0; v < triangles.length; v++, i+=3){
            position[i] = positionPolygon[3*triangles[v]];
            position[i+1] = positionPolygon[3*triangles[v]+1];
            position[i+2] = positionPolygon[3*triangles[v]+2];
            centroid[0] += position[i];
            centroid[1] += position[i+1];
            centroid[2] += position[i+2];
            posCount++;
        }
        polygons.push(positionPolygon);
    }
    GEOMETRY_STATS["triangulation_end"][GEOMETRY_STATS["triangulation_end"].length] = (new Date()).getTime();
    centroid = mult(centroid, 1.0/ posCount);
    for (i=0; i<3; i++) center[i] = centroid[i];
   
    // compute radius of bounding sphere
    for (v=0; v<posCount*3; v+=3){
        radius = Math.max(radius, normsq(minus(
                        [position[v], position[v+1], position[v+2]], centroid)));
    }
    radius = Math.sqrt(radius);

    // compute normals
    for (t=0; t<posCount*3; t+=9){
        U = minus([position[t+3], position[t+4],position[t+5]], 
                  [position[t  ], position[t+1],position[t+2]]);
        V = minus([position[t+6], position[t+7],position[t+8]], 
                  [position[t  ], position[t+1],position[t+2]]);
        N = cross(U, V);
        N = mult(N, 1.0/norm(N));
        for (i=0; i<9; i++) normal[t+i] = N[i%3];
    }
    for(; t < position.length; t+=9) {
        N = [1.0,0.0,0.0];
        for (i=0; i<9; i++) normal[t+i] = N[i%3];        
    }

    // set st
    /*for (i=0, t=0; t<textureCoord.length; t+=4, i+=6){ // 4 vtx per triangles
        st[i] = textureCoord[t][0];
        st[i+1] = textureCoord[t][1];
        st[i+2] = textureCoord[t+1][0];
        st[i+3] = textureCoord[t+1][1];
        st[i+4] = textureCoord[t+2][0];
        st[i+5] = textureCoord[t+2][1];
    }*/

    // compute tangents an binormals
    /*for (i=0, t=0, v=0; t<position.length; t+=9, v+=6, i+=9){
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
    }*/
    return {
        indices:indices,
        position:position, 
        normal:normal, 
        //tangent:tangent, 
        //binormal:binormal, 
        st:st, 
        bsphere_center:center, 
        bsphere_radius:radius,
        //polygons:polygons
    };
}

/* Swicth between Wfs geometry types to perform the appropriate conversion
 * to types arrays.
 *
 * Note: only Mutipolygon made of triangles are handled for the moment
 */
function geomFromWfs(type, coord, textureCoord){
    if (type == 'PolyhedralSurface') {
        return geomFromWfsPolyhedralSurface(coord, textureCoord);
    }
    if (type != 'MultiPolygon') throw "Unhandled geometry type '"+type+"'";

    if (type == 'MultiPolygon'){
        return geomFromWfsPolyhedralSurface(coord, textureCoord); // TODO : check if different process is necessary for multipolygon
    }
    throw "Unhandled geometry type '"+type+"'";
}

var texRe = /\((.*),"(.*)"\)/;

/* Parse returns a dictionary of the key=value pairs in the url
 */
function urlQueries(url){
    var param = url.replace(/^.*\?/,'').split('&');
    var queries = {};
    for (var i=0; i<param.length; i++){
        var kv = param[i].split('=');
        queries[kv[0].toUpperCase()] = kv[1];
    }
    return queries;
}

/* Whether or not we want to pack geometries (for DEBUG)
 */
var PACK_GEOMETRIES = false;

onmessage = function(o) {
    load(o.data.request, function(xhr) {
        GEOMETRY_STATS["geom_start"] = (new Date()).getTime();
        GEOMETRY_STATS["triangulation_start"] = [];
        GEOMETRY_STATS["triangulation_end"] = [];
        var positionLength = 0;
        var json = JSON.parse(xhr.responseText);
        var geoJson = json.geometries;
        for (var f = 0; f < geoJson.features.length; f++) {
            var bbox = new Float32Array(4);
            if (geoJson.features[f].geometry.bbox.length == 6){
                bbox[0] = geoJson.features[f].geometry.bbox[0];
                bbox[1] = geoJson.features[f].geometry.bbox[1];
                bbox[2] = geoJson.features[f].geometry.bbox[3];
                bbox[3] = geoJson.features[f].geometry.bbox[4];
            } else {
                bbox[0] = geoJson.features[f].geometry.bbox[0];
                bbox[1] = geoJson.features[f].geometry.bbox[1];
                bbox[2] = geoJson.features[f].geometry.bbox[2];
                bbox[3] = geoJson.features[f].geometry.bbox[3];
            }

            // temporarily removed textures
            //var texP = texRe.exec(geoJson.features[f].properties.tex);
            // remove the texture uv from properties
            // because we put it in the geometry
            //geoJson.features[f].properties.tex = {url:texP[1]};
            //var arrJson = texP[2].replace(/{/g, "[").replace(/}/g, "]");
            //var st = JSON.parse(arrJson);
            var coord = geoJson.features[f].geometry.coordinates;
            var type = geoJson.features[f].geometry.type;

            var geom = geomFromWfs(type, coord, coord/*st*/);
            
            // add attributes
            geom.properties = JSON.stringify(geoJson.features[f].properties);
            geom.bbox = bbox;
            positionLength += geom.position.length;

            postMessage({geom: geom, workerId: o.data.workerId},
                //geom, 
                [
                    geom.indices.buffer,
                    geom.position.buffer, 
                    geom.normal.buffer, 
                    //geom.tangent.buffer, 
                    //geom.binormal.buffer, 
                    geom.st.buffer, 
                    geom.bsphere_center.buffer,
                    geom.bbox.buffer
                ]
            );
                
        }
        GEOMETRY_STATS["geom_end"] = (new Date()).getTime();
        postMessage({workerId : o.data.workerId, stats : GEOMETRY_STATS, tiles: json.tiles});
        GEOMETRY_STATS = {};
    });
};

