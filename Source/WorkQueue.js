/** Deals with workers that can send multiple response after sending
 * an initial message 
 */
function WorkQueue(workerUrl){
    this._worker = new Worker(workerUrl);
    this._tasks = [];
    this._currentWorker = 0;
};

WorkQueue.prototype._updateWorker = function(){
    // if worker is free, dequeue
    if (this._worker.onmessage == null){ 
        var task = this._tasks.shift();
        if (typeof task != 'undefined'){
            console.log("start task");
            var that = this;
            this._worker.onmessage = (function(task, worker){
                    return function(m){
                    if (!task.callback(m)){
                        worker.onmessage = null;
                        that._updateWorker();
                    }};})(task, this._worker);
            this._worker.postMessage(task.msg);
        }
    }
};

// the callback function must return false when it's done
WorkQueue.prototype.addTask = function(message, callback){
    // the function is called each time a thread finishes
    this._tasks.push({msg:message, callback:callback});
    this._updateWorker();
};

