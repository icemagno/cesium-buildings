/**
 * Retrieves semantics from an OGC service
 *
 * @param options.url: the service's url
 * @param options.layerName: the name of the layer of interest
 */

var Semantics = function(options) {
	this._url = options.url;
	this._layer = options.layerName;
};

/**
 * Retrieves a list of attribute for the specified object
 *
 * @param gid: the identifier of the object
 * @param attributeName: a list of attributes to request
 * @param callback: the function that should be called when the request is completed
 */
Semantics.prototype.getAttributes = function(gid, attributesName, callback) {
	var attributesStr = "";
	for(var a in attributesName) {
		attributesStr += attributesName[a] + ",";
	}
	attributesStr = attributesStr.substring(0, attributesStr.length - 1);

	var request = this._url + "?query=getAttribute&city=" + this._layer + "&gid=" + gid + "&attribute=" + attributesStr;
	// TODO : add request to worker queue
	jQuery.ajax(request,{
        success: function(data, textStatus, jqXHR) {
			var attributes = parseAttributes(data);
			callback(attributes);
		},
        dataType: 'json',
        error: function(jqXHR, textStatus, errorThrown) {
			console.warn(jqXHR + textStatus+': '+errorThrown);
		}
	});
};

parseAttributes = function(data) {
	return data;
}