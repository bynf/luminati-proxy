#!/usr/bin/env node
// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const cluster = require('cluster');
const os = require('os');
const logger = require('./logger.js').child({category: 'MNGR'});

class Cluster_mgr {
    constructor(mgr){
        this.mgr = mgr;
    }
    run(){
        const cores = os.cpus().length;
        const num_workers = this.mgr.argv.cluster===true ?
            cores : Number(this.mgr.argv.cluster)||1;
        logger.notice('Master cluster setting up '+num_workers+' workers');
        cluster.setupMaster({
            exec: __dirname+'/worker.js',
            execArgv: process.execArgv.concat('--max-old-space-size=1024'),
        });
        this.mgr._defaults.num_workers = num_workers;
        const level = this.mgr.get_logger_level(this.mgr._defaults.log, true);
        for (let i=0; i<num_workers; i++)
        {
            const worker = cluster.fork();
            this.init_worker(worker, level);
        }
        cluster.on('exit', this.on_worker_exit.bind(this));
    }
    on_worker_exit(worker, code, signal){
        if (worker.exitedAfterDisconnect)
            return;
        this.mgr.perr('error', {
            ctx: 'worker_die',
            error: ''+code+': '+signal,
        });
        logger.warn('Worker with PID %s died (%s %s). Restarting...',
            worker.process.pid, code, signal);
        this.recreate_worker();
    }
    init_worker(worker, level){
        worker.setMaxListeners(0);
        worker.on('message', msg=>{
            if (msg.code=='CACHE_REPORT')
                this.mgr.cache_report.notify(worker.id, msg.space);
        });
        this.send_worker_setup(worker, level);
    }
    send_worker_setup(worker, level){
        worker.send({
            code: 'SETUP',
            level,
            customer: this.mgr._defaults.customer,
        });
    }
    run_workers(){
        const cores = os.cpus().length;
        const num_workers = this.mgr.argv.cluster===true ?
            cores : Number(this.mgr.argv.cluster)||1;
        logger.notice('Recreating '+num_workers+' workers');
        for (let i=0; i<num_workers; i++)
            this.recreate_worker();
    }
    recreate_worker(){
        const new_worker = cluster.fork();
        const level = this.mgr.get_logger_level(this.mgr._defaults.log, true);
        this.init_worker(new_worker, level);
        logger.notice('Worker with PID %s recreated', new_worker.process.pid);
        Object.values(this.mgr.proxy_ports).forEach(p=>{
            p.setup_worker(new_worker);
        });
    }
    kill_workers(){
        Object.values(cluster.workers).forEach(w=>{
            // killing worker process immediately with disconnecting
            // will not be rerun automatically
            w.kill('SIGKILL');
        });
    }
    workers_running(){
        return Object.values(cluster.workers);
    }
}

module.exports = Cluster_mgr;
