var load = require('./XmlHttpLoad.js');

/**
 * Sends back the raw request's response and the worker id.
 */
onmessage = function(o) {
    load(o.data.request, function(xhr) {
        postMessage({message: xhr.response, workerId: o.data.workerId});
    });
};

module.exports = onmessage;