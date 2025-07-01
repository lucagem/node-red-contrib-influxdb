var _ = require('lodash');

module.exports = function (RED) {
    "use strict";
    var Influx = require('influx');
    var { InfluxDB, Point } = require('@influxdata/influxdb-client');

    const VERSION_1X = '1.x';
    const VERSION_18_FLUX = '1.8-flux';
    const VERSION_20 = '2.0';

    /**
     * LucaT - Helper function per aggiornare lo status del nodo basato su dynamicEnabled e gestione errori
     */
    function updateNodeStatus(node, client, operationCount, errorState) {
        if (!client || !isConnectionEnabled(client.dynamicEnabled)) {
            // Nodo disabilitato - status rosso con icona
            node.status({
                fill: "red",
                shape: "ring",
                text: "disabled"
            });
            return false; // Connessione disabilitata
        } else if (errorState) {
            // Stato di errore - status giallo/arancione con icona di avviso
            var errorText = "error";
            if (typeof errorState === 'string') {
                errorText = errorState;
            } else if (errorState.message) {
                // Tronca il messaggio di errore se troppo lungo
                errorText = errorState.message.length > 27 ?
                    errorState.message.substring(0, 27) + "..." :
                    errorState.message;
            }

            node.status({
                fill: "red",
                shape: "ring",
                text: errorText
            });
            return true; // Connessione comunque abilitata
        } else {
            // Nodo abilitato - status verde con contatore opzionale
            var statusText = "ready";
            if (operationCount && operationCount > 0) {
                statusText = `ready (${operationCount})`;
            }
            node.status({
                fill: "green",
                shape: "dot",
                text: statusText
            });
            return true; // Connessione abilitata
        }
    }

    /**
     * LucaT - Helper function per mostrare temporaneamente lo stato di errore e poi tornare a ready
     */
    function showTemporaryError(node, client, error, operationCount) {
        // Mostra immediatamente l'errore
        updateNodeStatus(node, client, operationCount, error);

        // Dopo 3 secondi torna allo stato normale
        setTimeout(() => {
            updateNodeStatus(node, client, operationCount);
        }, 3000);
    }

    /**
     * LucaT - Helper function per creare un oggetto errore standardizzato
     */
    function createInfluxError(error) {
        var influxError = {
            errorMessage: error.message || error.toString() || "Unknown error"
        };

        // Se l'errore ha un response HTTP (versione 1.x), aggiungi lo status code
        if (error.res && error.res.statusCode) {
            influxError.statusCode = error.res.statusCode;
        } else if (error.statusCode) {
            // Se l'errore ha direttamente uno statusCode
            influxError.statusCode = error.statusCode;
        } else {
            // Default status code per errori generici
            influxError.statusCode = 503;
        }

        return influxError;
    }

    /**
     * LucaT - Helper function to check if connection is enabled based on dynamicEnabled value
     */
    function isConnectionEnabled(dynamicEnabled) {
        // Se dynamicEnabled è null, undefined o stringa vuota, la connessione è abilitata per default
        if (!dynamicEnabled || dynamicEnabled.trim() === '') {
            return true;
        }

        // Converte il valore in stringa e rimuove spazi
        var value = String(dynamicEnabled).trim().toLowerCase();

        // Controlla se il valore indica disabilitazione
        return !(value === 'false' || value === '0');
    }

    /**
     * Config node. Currently we only connect to one host.
     */
    function InfluxConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.hostname = n.hostname;
        this.port = n.port;
        this.database = n.database;
        this.name = n.name;

        // LucaT: Aggiunto supporto per dynamicEnabled
        this.dynamicEnabled = n.dynamicEnabled;

        var clientOptions = null;

        if (!n.influxdbVersion) {
            n.influxdbVersion = VERSION_1X;
        }

        if (n.influxdbVersion === VERSION_1X) {
            this.usetls = n.usetls;
            if (typeof this.usetls === 'undefined') {
                this.usetls = false;
            }
            // for backward compatibility with old 'protocol' setting
            if (n.protocol === 'https') {
                this.usetls = true;
            }
            if (this.usetls && n.tls) {
                var tlsNode = RED.nodes.getNode(n.tls);
                if (tlsNode) {
                    this.hostOptions = {};
                    tlsNode.addTLSOptions(this.hostOptions);
                }
            }
            this.client = new Influx.InfluxDB({
                hosts: [{
                    host: this.hostname,
                    port: this.port,
                    protocol: this.usetls ? "https" : "http",
                    options: this.hostOptions
                }],
                database: this.database,
                username: this.credentials.username,
                password: this.credentials.password
            });
        } else if (n.influxdbVersion === VERSION_18_FLUX || n.influxdbVersion === VERSION_20) {
            const timeout = Math.floor(+(n.timeout ? n.timeout : 10) * 1000) // convert from seconds to milliseconds

            const token = n.influxdbVersion === VERSION_18_FLUX ?
                `${this.credentials.username}:${this.credentials.password}` :
                this.credentials.token;

            clientOptions = {
                url: n.url,
                token,
                timeout,
                rejectUnauthorized: n.rejectUnauthorized
            }
            this.client = new InfluxDB(clientOptions);
        }
        // LucaT: Aggiuto metodo helper per verificare se la connessione è abilitata
        this.isConnectionEnabled = function () {
            return isConnectionEnabled(this.dynamicEnabled);
        };
        this.influxdbVersion = n.influxdbVersion;
    }

    /*
    InfluxConfigNode.prototype.toString = function () {
        return this.name ? this.name : this.hostname + ":" + this.port + "/" + this.database;
    };
    */

    RED.nodes.registerType("influxdb", InfluxConfigNode, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" },
            token: { type: "password" }
        }
    });

    function isIntegerString(value) {
        return /^-?\d+i$/.test(value);
    }

    function setFieldIntegers(fields) {
        for (const prop in fields) {
            const value = fields[prop];
            if (isIntegerString(value)) {
                fields[prop] = parseInt(value.substring(0, value.length - 1));
            }
        }
    }

    function addFieldToPoint(point, name, value) {
        if (name === 'time') {
            point.timestamp(value);
        } else if (typeof value === 'number') {
            point.floatField(name, value);
        } else if (typeof value === 'string') {
            // string values with numbers ending with 'i' are considered integers            
            if (isIntegerString(value)) {
                value = parseInt(value.substring(0, value.length - 1));
                point.intField(name, value);
            } else {
                point.stringField(name, value);
            }
        } else if (typeof value === 'boolean') {
            point.booleanField(name, value);
        }
    }

    function addFieldsToPoint(point, fields) {
        for (const prop in fields) {
            const value = fields[prop];
            addFieldToPoint(point, prop, value);
        }
    }

    // write using influx-client-js
    function writePoints(msg, node, done) {
        var measurement = msg.hasOwnProperty('measurement') ? msg.measurement : node.measurement;
        if (!measurement) {
            // LucaT: Ripristina status anche in caso di errore
            updateNodeStatus(node, node.influxdbConfig, node.writeCount);
            return done(RED._("influxdb.errors.nomeasurement"));
        }
        try {
            if (_.isArray(msg.payload) && msg.payload.length > 0) {
                // array of arrays: multiple points with fields and tags
                if (_.isArray(msg.payload[0]) && msg.payload[0].length > 0) {
                    msg.payload.forEach(element => {
                        let point = new Point(measurement);
                        let fields = element[0];
                        addFieldsToPoint(point, fields);
                        let tags = element[1];
                        for (const prop in tags) {
                            point.tag(prop, tags[prop]);
                        }
                        node.client.writePoint(point);
                    });
                } else {
                    // array of non-arrays: one point with both fields and tags
                    let point = new Point(measurement);
                    let fields = msg.payload[0];
                    addFieldsToPoint(point, fields);
                    const tags = msg.payload[1];
                    for (const prop in tags) {
                        point.tag(prop, tags[prop]);
                    }
                    node.client.writePoint(point)
                }
            } else {
                // single object: fields only
                if (_.isPlainObject(msg.payload)) {
                    let point = new Point(measurement);
                    let fields = msg.payload;
                    addFieldsToPoint(point, fields);
                    node.client.writePoint(point);
                } else {
                    // just a value
                    let point = new Point(measurement);
                    let value = msg.payload;
                    addFieldToPoint(point, 'value', value);
                    node.client.writePoint(point);
                }
            }

            node.client.flush(true).then(() => {
                // LucaT: Ripristina status a "ready" dopo aver completato la scrittura
                updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                done();
            }).catch(error => {
                // LucaT: usa createInfluxError per standardizzare l'errore
                msg.influx_error = createInfluxError(error);
                // LucaT: Mostra errore temporaneamente poi torna a "ready"
                showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                done(error);
            });
        } catch (error) {
            msg.influx_error = {
                errorMessage: error
            };
            // LucaT: Ripristina status a "ready" dopo aver completato la scrittura
            updateNodeStatus(node, node.influxdbConfig, node.writeCount);
            done(error);
        }
    }

    /**
     * Output node to write to a single influxdb measurement
     */
    function InfluxOutNode(n) {
        RED.nodes.createNode(this, n);
        this.measurement = n.measurement;
        this.influxdb = n.influxdb;
        this.influxdbConfig = RED.nodes.getNode(this.influxdb);
        this.precision = n.precision;
        this.retentionPolicy = n.retentionPolicy;

        // 1.8 and 2.0 only
        this.database = n.database;
        this.precisionV18FluxV20 = n.precisionV18FluxV20;
        this.retentionPolicyV18Flux = n.retentionPolicyV18Flux;
        this.org = n.org;
        this.bucket = n.bucket;

        // LucaT: Aggiungi contatore delle operazioni
        this.writeCount = 0;
        // LucaT: Controlla e aggiorna status all'inizializzazione
        var connectionEnabled = updateNodeStatus(this, this.influxdbConfig);

        if (!this.influxdbConfig) {
            this.error(RED._("influxdb.errors.missingconfig"));
            return;
        }
        let version = this.influxdbConfig.influxdbVersion;

        var node = this;

        if (version === VERSION_1X) {
            var client = this.influxdbConfig.client;

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!connectionEnabled) {
                    // Se disabilitato, aggiorna lo status e ignora silenziosamente
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }
                // LucaT: Aggiorna status a "writing" durante l'operazione
                // LucaT: Incrementa contatore e aggiorna status a "writing"
                node.writeCount++;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `writing (${node.writeCount})`
                });

                var measurement;
                var writeOptions = {};

                var measurement = msg.hasOwnProperty('measurement') ? msg.measurement : node.measurement;
                if (!measurement) {
                    return done(RED._("influxdb.errors.nomeasurement"));
                }
                var precision = msg.hasOwnProperty('precision') ? msg.precision : node.precision;
                var retentionPolicy = msg.hasOwnProperty('retentionPolicy') ? msg.retentionPolicy : node.retentionPolicy;

                if (precision) {
                    writeOptions.precision = precision;
                }

                if (retentionPolicy) {
                    writeOptions.retentionPolicy = retentionPolicy;
                }

                // format payload to match new writePoints API
                var points = [];
                var point;
                if (_.isArray(msg.payload) && msg.payload.length > 0) {
                    // array of arrays
                    if (_.isArray(msg.payload[0]) && msg.payload[0].length > 0) {
                        msg.payload.forEach(function (nodeRedPoint) {
                            let fields = _.clone(nodeRedPoint[0])
                            point = {
                                measurement: measurement,
                                fields,
                                tags: nodeRedPoint[1]
                            }
                            setFieldIntegers(point.fields)
                            if (point.fields.time) {
                                point.timestamp = point.fields.time;
                                delete point.fields.time;
                            }
                            points.push(point);
                        });
                    } else {
                        // array of non-arrays, assume one point with both fields and tags
                        let fields = _.clone(msg.payload[0])
                        point = {
                            measurement: measurement,
                            fields,
                            tags: msg.payload[1]
                        };
                        setFieldIntegers(point.fields)
                        if (point.fields.time) {
                            point.timestamp = point.fields.time;
                            delete point.fields.time;
                        }
                        points.push(point);
                    }
                } else {
                    // fields only
                    if (_.isPlainObject(msg.payload)) {
                        let fields = _.clone(msg.payload)
                        point = {
                            measurement: measurement,
                            fields,
                        };
                        setFieldIntegers(point.fields)
                        if (point.fields.time) {
                            point.timestamp = point.fields.time;
                            delete point.fields.time;
                        }
                    } else {
                        // just a value
                        point = {
                            measurement: measurement,
                            fields: { value: msg.payload }
                        };
                        setFieldIntegers(point.fields)
                    }
                    points.push(point);
                }
                client.writePoints(points, writeOptions).then(() => {
                    // Alla fine dell'operazione, ripristina lo status
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                }).catch(error => {
                    // LucaT: usa createInfluxError per standardizzare l'errore
                    msg.influx_error = createInfluxError(error);
                    // LucaT: Mostra errore temporaneamente poi torna a "ready"
                    showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                    done(error);
                });
            });
        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            let bucket = this.bucket;
            if (version === VERSION_18_FLUX) {
                let retentionPolicy = this.retentionPolicyV18Flux ? this.retentionPolicyV18Flux : 'autogen';
                bucket = `${this.database}/${retentionPolicy}`;
            }
            let org = version === VERSION_18_FLUX ? '' : this.org;

            this.client = this.influxdbConfig.client.getWriteApi(org, bucket, this.precisionV18FluxV20);


            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Se disabilitato, aggiorna lo status e ignora silenziosamente
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }
                // LucaT: Aggiorna status a "writing" durante l'operazione
                node.writeCount++;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `writing (${node.writeCount})`
                });
                writePoints(msg, node, done);
            });
        }
        // LucaT: Ascolta le modifiche alla configurazione
        this.on('close', function () {
            node.status({});
        });
    }

    RED.nodes.registerType("influxdb out", InfluxOutNode);

    /**
     * Output node to write to multiple InfluxDb measurements
     */
    function InfluxBatchNode(n) {
        RED.nodes.createNode(this, n);
        this.influxdb = n.influxdb;
        this.influxdbConfig = RED.nodes.getNode(this.influxdb);
        this.precision = n.precision;
        this.retentionPolicy = n.retentionPolicy;

        // 1.8 and 2.0
        this.database = n.database;
        this.precisionV18FluxV20 = n.precisionV18FluxV20;
        this.retentionPolicyV18Flux = n.retentionPolicyV18Flux;
        this.org = n.org;
        this.bucket = n.bucket;


        if (!this.influxdbConfig) {
            this.error(RED._("influxdb.errors.missingconfig"));
            return;
        }
        let version = this.influxdbConfig.influxdbVersion;

        var node = this;

        if (version === VERSION_1X) {
            var client = this.influxdbConfig.client;

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Connessione disabilitata - ignora silenziosamente l'operazione
                    done();
                    return;
                }
                var writeOptions = {};
                var precision = msg.hasOwnProperty('precision') ? msg.precision : node.precision;
                var retentionPolicy = msg.hasOwnProperty('retentionPolicy') ? msg.retentionPolicy : node.retentionPolicy;

                if (precision) {
                    writeOptions.precision = precision;
                }

                if (retentionPolicy) {
                    writeOptions.retentionPolicy = retentionPolicy;
                }

                client.writePoints(msg.payload, writeOptions).then(() => {
                    done();
                }).catch(error => {
                    // LucaT: usa createInfluxError per standardizzare l'errore
                    msg.influx_error = createInfluxError(error);
                    // LucaT: Mostra errore temporaneamente poi torna a "ready"
                    showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                    done(error);
                });
            });
        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            let bucket = node.bucket;
            if (version === VERSION_18_FLUX) {
                let retentionPolicy = this.retentionPolicyV18Flux ? this.retentionPolicyV18Flux : 'autogen';
                bucket = `${this.database}/${retentionPolicy}`;
            }
            let org = version === VERSION_18_FLUX ? '' : this.org;

            var client = this.influxdbConfig.client.getWriteApi(org, bucket, this.precisionV18FluxV20);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Connessione disabilitata - ignora silenziosamente l'operazione
                    done();
                    return;
                }
                msg.payload.forEach(element => {
                    let point = new Point(element.measurement);

                    // time is reserved as a field name still! will be overridden by the timestamp below.
                    addFieldsToPoint(point, element.fields);

                    let tags = element.tags;
                    if (tags) {
                        for (const prop in tags) {
                            point.tag(prop, tags[prop]);
                        }
                    }
                    if (element.timestamp) {
                        point.timestamp(element.timestamp);
                    }
                    client.writePoint(point);
                });

                // ensure we write everything including scheduled retries
                client.flush(true).then(() => {
                    done();
                }).catch(error => {
                    // LucaT: usa createInfluxError per standardizzare l'errore
                    msg.influx_error = createInfluxError(error);
                    // LucaT: Mostra errore temporaneamente poi torna a "ready"
                    showTemporaryError(node, node.influxdbConfig, error, node.readCount || node.writeCount);
                    done(error);
                });
            });
        }
    }

    RED.nodes.registerType("influxdb batch", InfluxBatchNode);

    /**
     * Input node to make queries to influxdb
     */
    function InfluxInNode(n) {
        RED.nodes.createNode(this, n);
        this.influxdb = n.influxdb;
        this.query = n.query;
        this.precision = n.precision;
        this.retentionPolicy = n.retentionPolicy;
        this.rawOutput = n.rawOutput;
        this.influxdbConfig = RED.nodes.getNode(this.influxdb);
        this.org = n.org;

        if (!this.influxdbConfig) {
            this.error(RED._("influxdb.errors.missingconfig"));
            return;
        }

        let version = this.influxdbConfig.influxdbVersion
        if (version === VERSION_1X) {
            var node = this;
            var client = this.influxdbConfig.client;

            // LucaT: Aggiunta variabile per conteggio operazioni di lettura
            node.readCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            updateNodeStatus(node, node.influxdbConfig, node.readCount);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Se disabilitato, aggiorna lo status e ignora silenziosamente
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }
                // LucaT: Aggiorna status a "reading" durante l'operazione
                node.readCount++;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `reading (${node.readCount})`
                });

                var query;
                var rawOutput;
                var queryOptions = {};
                var precision;
                var retentionPolicy;

                query = msg.hasOwnProperty('query') ? msg.query : node.query;
                if (!query) {
                    return done(RED._("influxdb.errors.noquery"));
                }

                rawOutput = msg.hasOwnProperty('rawOutput') ? msg.rawOutput : node.rawOutput;
                precision = msg.hasOwnProperty('precision') ? msg.precision : node.precision;
                retentionPolicy = msg.hasOwnProperty('retentionPolicy') ? msg.retentionPolicy : node.retentionPolicy;

                if (precision) {
                    queryOptions.precision = precision;
                }

                if (retentionPolicy) {
                    queryOptions.retentionPolicy = retentionPolicy;
                }

                if (rawOutput) {
                    var queryPromise = client.queryRaw(query, queryOptions);
                } else {
                    var queryPromise = client.query(query, queryOptions);
                }

                queryPromise.then(function (results) {
                    msg.payload = results;
                    send(msg);
                    // LucaT: Ripristina lo status a "ready" dopo la lettura
                    updateNodeStatus(node, node.influxdbConfig, node.readCount);
                    done();
                }).catch(error => {
                    // LucaT: usa createInfluxError per standardizzare l'errore
                    msg.influx_error = createInfluxError(error);
                    // LucaT: Mostra errore temporaneamente poi torna a "ready"
                    showTemporaryError(node, node.influxdbConfig, error, node.readCount);
                    done(error);
                });
            });

        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            let org = version === VERSION_20 ? this.org : ''
            this.client = this.influxdbConfig.client.getQueryApi(org);
            var node = this;

            // LucaT: Aggiunta variabile per conteggio operazioni di lettura
            node.readCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            updateNodeStatus(node, node.influxdbConfig, node.readCount);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Se disabilitato, aggiorna lo status e ignora silenziosamente
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }
                // LucaT: Aggiorna status a "reading" durante l'operazione
                node.readCount++;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `reading (${node.readCount})`
                });

                var query = msg.hasOwnProperty('query') ? msg.query : node.query;
                if (!query) {
                    return done(RED._("influxdb.errors.noquery"));
                }
                var output = [];
                node.client.queryRows(query, {
                    next(row, tableMeta) {
                        var o = tableMeta.toObject(row)
                        output.push(o);
                    },
                    error(error) {
                        // LucaT: usa createInfluxError per standardizzare l'errore
                        msg.influx_error = createInfluxError(error);
                        // LucaT: Mostra errore temporaneamente poi torna a "ready"
                        showTemporaryError(node, node.influxdbConfig, error, node.readCount);
                        done(error);
                    },
                    complete() {
                        msg.payload = output;
                        send(msg);
                        // LucaT: Ripristina lo status a "ready" dopo la lettura
                        updateNodeStatus(node, node.influxdbConfig, node.readCount);
                        done();
                    },
                });
            });
        }
        // LucaT: Ascolta le modifiche alla configurazione
        this.on('close', function () {
            node.status({});
        });
    }

    RED.nodes.registerType("influxdb in", InfluxInNode);
}
