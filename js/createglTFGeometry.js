/* This worker thread receives messages containing urls of wfs data
 *
 * The worker will send a message for each loaded feature.
 * The properties (attributes) are sent as a json string that can be 
 * parsed by the caller.
 *
 * Once the url features have been exhausted, the message 'done' is sent.
 */

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
    xhr.responseType = "arraybuffer"

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

var pending = 0;

onmessage = function(o) {
    load(o.data.request, function(xhr) {
        var ab = xhr.response;

        //var model = new Cesium.Model({gltf : bglTF});

        /*var positionLength = 0;
        var geoJson = JSON.parse(xhr.responseText);
        for (var f = 0; f < geoJson.features.length; f++) {
            

            var geom = geomFromWfs(type, coord, coord);
            
            // add attributes
            geom.properties = JSON.stringify(geoJson.features[f].properties);
            geom.bbox = bbox;
            positionLength += geom.position.length;*/

            postMessage({geom: ab, workerId : o.data.workerId}, [ab]/*,
                //geom, 
                [
                    geom.indices.buffer,
                    geom.position.buffer, 
                    geom.normal.buffer, 
                    geom.tangent.buffer, 
                    geom.binormal.buffer, 
                    geom.st.buffer, 
                    geom.bsphere_center.buffer,
                    geom.bbox.buffer
                ]*/
            );
                
        //}
        //postMessage({workerId : o.data.workerId});
    });
};

