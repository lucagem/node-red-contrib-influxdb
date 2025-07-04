var _ = require('lodash');

module.exports = function (RED) {
    "use strict";
    var Influx = require('influx');
    var { InfluxDB, Point } = require('@influxdata/influxdb-client');

    const VERSION_1X = '1.x';
    const VERSION_18_FLUX = '1.8-flux';
    const VERSION_20 = '2.0';

    /**
     * LucaT: Helper function per gestire il version override - restituisce null se non deve intervenire
     */
    function getDynamicVersion(dynamicVersion) {
        if (!dynamicVersion || dynamicVersion.trim() === "" || isEnvironmentVariable(dynamicVersion)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicVersion.trim();
        // Mappa i valori alle versioni corrette
        switch (trimmedValue) {
            case "1":
                return VERSION_1X;
            case "1.8":
                return VERSION_18_FLUX;
            case "2":
                return VERSION_20;
            default:
                // Se è una variabile di ambiente o valore non riconosciuto, non intervenire
                return null;
        }
    }
    /**
     * Helper per precision values
     */
    function getDynamicPrecision(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim();
        const validPrecisions = ['ns', 'us', 'ms', 's', 'n', 'u', 'm', 'h', 'd', 'w'];
        return validPrecisions.includes(trimmedValue) ? trimmedValue : null;
    }

    /**
     * LucaT - Helper function per capire se un valore è una variabile di ambiente
     */
    function isEnvironmentVariable(value) {
        // Controlla se il valore è una variabile di ambiente
        // per evitare che ci siano variabilidi ambiente non risolte
        if (value && typeof value === 'string' && value.startsWith("${") && value.endsWith("}")) {
            // scrive un log di debug per c'è una variabile di ambiente non risolta
            RED.log.debug(`Detected environment variable NOT SOLVED: [${value}`);
            return true; // È una variabile di ambiente
        } else {
            return false; // Non è una variabile di ambiente
        }
    }

    /**
     * LucaT: Helper functions generici per gestire gli override dei parametri dinamici
     */
    function getDynamicStringNotEmpty(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim();
        return trimmedValue.length > 0 ? trimmedValue : null;
    }
    function getDynamicPositiveInteger(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim();
        const intValue = parseInt(trimmedValue);
        return !isNaN(intValue) && intValue > 0 ? intValue : null;
    }
    function getDynamicPort(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim();
        const portValue = parseInt(trimmedValue);
        return !isNaN(portValue) && portValue > 0 && portValue <= 65535 ? portValue : null;
    }
    function getDynamicUrl(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim();
        return (trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")) ? trimmedValue : null;
    }
    function getDynamicBoolean(value) {
        if (!value || value.trim() === "" || isEnvironmentVariable(value)) {
            return null; // Non intervenire
        }
        const trimmedValue = value.trim().toLowerCase();
        if (["true", "1"].includes(trimmedValue)) return true;
        if (["false", "0"].includes(trimmedValue)) return false;
        return null; // Valore non valido
    }

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

        // LucaT: Aggiunto supporto per valori dinamici
        this.dynamicEnabled = n.dynamicEnabled;

        var clientOptions = null;

        if (!n.influxdbVersion) {
            n.influxdbVersion = VERSION_1X;
        }

        const dynamicVersionOverride = getDynamicVersion(n.dynamicVersion);
        const dynamicHostnameOverride = getDynamicStringNotEmpty(n.dynamicHostname);
        const dynamicPortOverride = getDynamicPort(n.dynamicPort);
        const dynamicUrlOverride = getDynamicUrl(n.dynamicUrl);
        const dynamicDatabaseOverride = getDynamicStringNotEmpty(n.dynamicDatabase);
        const dynamicUsernameOverride = getDynamicStringNotEmpty(n.dynamicUsername);
        const dynamicPasswordOverride = getDynamicStringNotEmpty(n.dynamicPassword);
        const dynamicTokenOverride = getDynamicStringNotEmpty(n.dynamicToken);
        const dynamicTimeoutOverride = getDynamicPositiveInteger(n.dynamicTimeout);
        const dynamicVerifyCertificateOverride = getDynamicBoolean(n.dynamicVerifyCertificate)

        // LucaT: Gestione version override (INIZIO) - sostituisce il valore originale se necessario
        if (dynamicVersionOverride !== null) {
            const originalVersion = n.influxdbVersion;
            n.influxdbVersion = dynamicVersionOverride;
            // Log del cambiamento
            RED.log.info(`InfluxDb dynamic override version changed from [${originalVersion}] to [${n.influxdbVersion}]`);
        }
        if (n.influxdbVersion === VERSION_1X) {
            // LucaT: Gestione override parametri specifici per Version 1.0 - DA TESTARE
            // Override Hostname per 1.0            
            if (dynamicHostnameOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Hostname (1.0) changed from [${this.hostname}] to [${dynamicHostnameOverride}]`);
                this.hostname = dynamicHostnameOverride;
            }
            // Override Port per 1.0
            if (dynamicPortOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Port (1.0) changed from [${this.port}] to [${dynamicPortOverride}]`);
                this.port = dynamicPortOverride;
            }
            // Override Database per 1.0            
            if (dynamicDatabaseOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Database (1.0) changed from [${this.database}] to [${dynamicDatabaseOverride}]`);
                this.database = dynamicDatabaseOverride;
            }
            // Override Username per 1.0
            if (dynamicUsernameOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Username (1.0) changed (hidden for security)`);
                // Lo username verrà gestito nella sezione credentials più avanti
            }
            // Override Password per 1.0
            if (dynamicPasswordOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Password (1.0) changed (hidden for security)`);
                // La password verrà gestita nella sezione credentials più avanti
            }
        } else if (n.influxdbVersion === VERSION_18_FLUX) {
            // LucaT: Gestione override parametri specifici per Version 1.8-flux
            // Override URL per 1.8-flux
            if (dynamicUrlOverride !== null) {
                RED.log.info(`InfluxDb dynamic override URL (1.8-flux) changed from [${n.url}] to [${dynamicUrlOverride}]`);
                n.url = dynamicUrlOverride;
            }
            // Override Username per 1.8-flux
            if (dynamicUsernameOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Username (1.8-flux) changed (hidden for security)`);
                // Lo username verrà gestito nella sezione credentials più avanti
            }
            // Override Password per 1.8-flux
            if (dynamicPasswordOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Password (1.8-flux) changed (hidden for security)`);
                // La password verrà gestita nella sezione credentials più avanti
            }
        } else if (n.influxdbVersion === VERSION_20) {
            // LucaT: Gestione override parametri specifici per Version 2.0
            // Override URL
            if (dynamicUrlOverride !== null) {
                RED.log.info(`InfluxDb dynamic override URL changed from [${n.url}] to [${dynamicUrlOverride}]`);
                n.url = dynamicUrlOverride;
            }
            // Override Token (viene gestito nelle credentials)
            if (dynamicTokenOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Token changed (hidden for security)`);
                // Il token verrà gestito nella sezione credentials più avanti
            }
            // Override Timeout
            if (dynamicTimeoutOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Timeout changed from [${n.timeout}] to [${dynamicTimeoutOverride}]`);
                n.timeout = dynamicTimeoutOverride;
            }
        }
        // LucaT: Gestione version override (FINE)

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

            // LucaT: (INIZIO) Gestione override delle credenziali per VERSION_1X
            let username = this.credentials.username;
            let password = this.credentials.password;
            if (dynamicUsernameOverride !== null) {
                username = dynamicUsernameOverride;
            }
            if (dynamicPasswordOverride !== null) {
                password = dynamicPasswordOverride;
            }
            this.client = new Influx.InfluxDB({
                hosts: [{
                    host: this.hostname,
                    port: this.port,
                    protocol: this.usetls ? "https" : "http",
                    options: this.hostOptions
                }],
                database: this.database,
                username: username,
                password: password
            });
            // LucaT: (FINE) Gestione override delle credenziali per VERSION_1X

        } else if (n.influxdbVersion === VERSION_18_FLUX || n.influxdbVersion === VERSION_20) {
            const timeout = Math.floor(+(n.timeout ? n.timeout : 10) * 1000) // convert from seconds to milliseconds
            // LucaT: Gestione override delle credenziali prottette
            let token;
            if (n.influxdbVersion === VERSION_18_FLUX) {
                // VERSION_18_FLUX - controlla se ci sono override per username/password
                let username = this.credentials.username;
                let password = this.credentials.password;
                const dynamicUsernameOverride = getDynamicStringNotEmpty(n.dynamicUsername);
                if (dynamicUsernameOverride !== null) {
                    username = dynamicUsernameOverride;
                }
                const dynamicPasswordOverride = getDynamicStringNotEmpty(n.dynamicPassword);
                if (dynamicPasswordOverride !== null) {
                    password = dynamicPasswordOverride;
                }
                token = `${username}:${password}`;
            } else {
                // VERSION_20 - controlla se c'è un override del token
                token = dynamicTokenOverride !== null ? dynamicTokenOverride : this.credentials.token;
            }

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
        // LucaT: Incrementa il contatore delle operazioni all'inizio della funzione
        node.writeCount++;
        node.status({
            fill: "blue",
            shape: "dot",
            text: `writing (${node.writeCount})`
        });

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

        // LucaT: Dynamic Properties per nodo OUT - gestione override
        const dynamicMeasurementOut = getDynamicStringNotEmpty(n.dynamicMeasurementOut);
        const dynamicDatabaseOut = getDynamicStringNotEmpty(n.dynamicDatabaseOut);
        const dynamicRetentionPolicyOut = getDynamicStringNotEmpty(n.dynamicRetentionPolicyOut);
        const dynamicOrgOut = getDynamicStringNotEmpty(n.dynamicOrgOut);
        const dynamicBucketOut = getDynamicStringNotEmpty(n.dynamicBucketOut);
        const dynamicPrecisionOut = getDynamicPrecision(n.dynamicPrecisionOut);

        // LucaT: Applica gli override se disponibili
        if (dynamicMeasurementOut !== null) {
            RED.log.info(`InfluxDb OUT dynamic override Measurement changed from [${this.measurement}] to [${dynamicMeasurementOut}]`);
            this.measurement = dynamicMeasurementOut;
        }
        if (dynamicDatabaseOut !== null) {
            RED.log.info(`InfluxDb OUT dynamic override Database changed from [${this.database}] to [${dynamicDatabaseOut}]`);
            this.database = dynamicDatabaseOut;
        }
        if (dynamicRetentionPolicyOut !== null) {
            // Per 1.x usa retentionPolicy, per 1.8-flux usa retentionPolicyV18Flux
            if (this.influxdbConfig.influxdbVersion === VERSION_1X) {
                RED.log.info(`InfluxDb OUT dynamic override RetentionPolicy (1.x) changed from [${this.retentionPolicy}] to [${dynamicRetentionPolicyOut}]`);
                this.retentionPolicy = dynamicRetentionPolicyOut;
            } else if (this.influxdbConfig.influxdbVersion === VERSION_18_FLUX) {
                RED.log.info(`InfluxDb OUT dynamic override RetentionPolicyV18Flux changed from [${this.retentionPolicyV18Flux}] to [${dynamicRetentionPolicyOut}]`);
                this.retentionPolicyV18Flux = dynamicRetentionPolicyOut;
            }
        }
        if (dynamicOrgOut !== null) {
            RED.log.info(`InfluxDb OUT dynamic override Organization changed from [${this.org}] to [${dynamicOrgOut}]`);
            this.org = dynamicOrgOut;
        }
        if (dynamicBucketOut !== null) {
            RED.log.info(`InfluxDb OUT dynamic override Bucket changed from [${this.bucket}] to [${dynamicBucketOut}]`);
            this.bucket = dynamicBucketOut;
        }
        if (dynamicPrecisionOut !== null) {
            // Per 1.x usa precision, per 1.8-flux e 2.0 usa precisionV18FluxV20
            if (this.influxdbConfig.influxdbVersion === VERSION_1X) {
                RED.log.info(`InfluxDb OUT dynamic override Precision (1.x) changed from [${this.precision}] to [${dynamicPrecisionOut}]`);
                this.precision = dynamicPrecisionOut;
            } else if (this.influxdbConfig.influxdbVersion === VERSION_18_FLUX || this.influxdbConfig.influxdbVersion === VERSION_20) {
                RED.log.info(`InfluxDb OUT dynamic override PrecisionV18FluxV20 changed from [${this.precisionV18FluxV20}] to [${dynamicPrecisionOut}]`);
                this.precisionV18FluxV20 = dynamicPrecisionOut;
            }
        }

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
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }

                // LucaT: Incrementa contatore e aggiorna status a "writing"
                node.writeCount++;
                node.status({
                    fill: "blue",
                    shape: "dot",
                    text: `writing (${node.writeCount})`
                });

                var measurement;
                var writeOptions = {};

                // LucaT: Supporta override dinamico del measurement anche via messaggio
                var measurement = msg.hasOwnProperty('measurement') ? msg.measurement : node.measurement;
                if (!measurement) {
                    updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                    return done(RED._("influxdb.errors.nomeasurement"));
                }

                // LucaT: Supporta override dinamico di precision e retentionPolicy anche via messaggio
                var precision = msg.hasOwnProperty('precision') ? msg.precision : node.precision;
                var retentionPolicy = msg.hasOwnProperty('retentionPolicy') ? msg.retentionPolicy : node.retentionPolicy;

                if (precision) {
                    writeOptions.precision = precision;
                }

                if (retentionPolicy) {
                    writeOptions.retentionPolicy = retentionPolicy;
                }

                // ... resto del codice per la scrittura (rimane uguale)
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
                    updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                    done();
                }).catch(error => {
                    msg.influx_error = createInfluxError(error);
                    showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                    done(error);
                });
            });
        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            // LucaT: Contatore delle operazioni di scrittura
            this.writeCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            var connectionEnabled = updateNodeStatus(this, this.influxdbConfig);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!connectionEnabled) {
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }

                // LucaT: Gestione dinamica di bucket e org per supportare override
                // IMPORTANTE: Questa logica deve essere dentro l'input handler per garantire
                // che gli override dinamici siano già stati applicati
                let bucket;
                let org;
                if (version === VERSION_18_FLUX) {
                    // Per 1.8-flux, il bucket è sempre database/retention
                    // Usa i valori potenzialmente overridden
                    let retentionPolicy = node.retentionPolicyV18Flux ? node.retentionPolicyV18Flux : 'autogen';
                    bucket = `${node.database}/${retentionPolicy}`;
                    org = '';
                } else {
                    // Per 2.0, usa i valori (potenzialmente overridden)
                    bucket = node.bucket;
                    org = node.org;
                }
                // LucaT: Crea il writeApi ad ogni input con i parametri aggiornati
                node.client = node.influxdbConfig.client.getWriteApi(org, bucket, node.precisionV18FluxV20);
                writePoints(msg, node, done);
            });
        }        // LucaT: Ascolta le modifiche alla configurazione
        this.on('close', function () {
            node.status({});
        });
    }

    RED.nodes.registerType("influxdb out", InfluxOutNode);

    /**
     * Output node to write to multiple InfluxDb measurements
     */
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

        // LucaT: Dynamic Properties per nodo BATCH - gestione override (se necessari)
        // Per ora il nodo BATCH non ha proprietà dinamiche specifiche nell'HTML,
        // ma se servissero in futuro, la logica sarebbe simile al nodo OUT

        if (!this.influxdbConfig) {
            this.error(RED._("influxdb.errors.missingconfig"));
            return;
        }
        let version = this.influxdbConfig.influxdbVersion;

        var node = this;

        if (version === VERSION_1X) {
            var client = this.influxdbConfig.client;

            // LucaT: Aggiunta variabile per conteggio operazioni di scrittura
            node.writeCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            updateNodeStatus(node, node.influxdbConfig, node.writeCount);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
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

                var writeOptions = {};
                var precision = msg.hasOwnProperty('precision') ? msg.precision : node.precision;
                var retentionPolicy = msg.hasOwnProperty('retentionPolicy') ?
                    msg.retentionPolicy : node.retentionPolicy;
                var database = msg.hasOwnProperty('database') ? msg.database : node.database;

                if (precision) {
                    writeOptions.precision = precision;
                }

                if (retentionPolicy) {
                    writeOptions.retentionPolicy = retentionPolicy;
                }

                if (database) {
                    writeOptions.database = database;
                }

                if (_.isArray(msg.payload) && msg.payload.length > 0) {
                    client.writePoints(msg.payload, writeOptions).then(() => {
                        updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                        done();
                    }).catch(error => {
                        msg.influx_error = createInfluxError(error);
                        showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                        done(error);
                    });
                } else {
                    updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                    done();
                }
            });
        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            // LucaT: Aggiunta variabile per conteggio operazioni di scrittura
            node.writeCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            updateNodeStatus(node, node.influxdbConfig, node.writeCount);

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
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

                // LucaT: Gestione dinamica bucket e org per supportare override
                let bucket;
                let org;
                if (version === VERSION_18_FLUX) {
                    // Per 1.8-flux, il bucket è sempre database/retention
                    let retentionPolicy = node.retentionPolicyV18Flux ? node.retentionPolicyV18Flux : 'autogen';
                    bucket = `${node.database}/${retentionPolicy}`;
                    org = '';
                    // LucaT: Log dettagliato per debug
                    RED.log.info(`InfluxDB 1.8-flux BATCH: node.database=[${node.database}], retentionPolicy=[${retentionPolicy}], bucket=[${bucket}], org=[${org}]`);
                } else {
                    // Per 2.0, usa i valori (potenzialmente overridden)
                    bucket = node.bucket;
                    org = node.org;
                    // LucaT: Log dettagliato per debug  
                    RED.log.info(`InfluxDB 2.0 BATCH: bucket=[${bucket}], org=[${org}]`);
                }

                // LucaT: Crea un nuovo writeApi ad ogni input con i parametri aggiornati
                var client = node.influxdbConfig.client.getWriteApi(org, bucket, node.precisionV18FluxV20);

                if (_.isArray(msg.payload) && msg.payload.length > 0) {

                    msg.payload.forEach(element => {
                        let measurement = element.measurement;
                        let point = new Point(measurement);
                        // timestamp and tags are optional in the element
                        // fields are required - if not specified it will be set to the payload minus the measurement
                        let fields = element.fields === undefined ? _.omit(element, ['measurement', 'timestamp', 'tags']) : element.fields;

                        // if there are no fields, show an error - cant have an empty InfluxDb write!
                        if (_.isEmpty(fields)) {
                            msg.influx_error = createInfluxError(new Error("Fields are required"));
                            updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                            return done(new Error("Fields are required"));
                        }

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
                        updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                        done();
                    }).catch(error => {
                        msg.influx_error = createInfluxError(error);
                        showTemporaryError(node, node.influxdbConfig, error, node.writeCount);
                        done(error);
                    });
                } else {
                    updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                    done();
                }
            });
        }
        // LucaT: Ascolta le modifiche alla configurazione
        this.on('close', function () {
            node.status({});
        });
    }
    RED.nodes.registerType("influxdb batch", InfluxBatchNode);

    /**
     * Input node to make queries to influxdb
     */
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

        // LucaT: Dynamic Properties per nodo IN - gestione override (se necessari)
        // Il nodo IN al momento non ha proprietà dinamiche specifiche nell'HTML,
        // ma potremmo aggiungere override per query, organization, ecc. se necessario

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
                    updateNodeStatus(node, node.influxdbConfig, node.readCount);
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
                    updateNodeStatus(node, node.influxdbConfig, node.readCount);
                    done();
                }).catch(error => {
                    msg.influx_error = createInfluxError(error);
                    showTemporaryError(node, node.influxdbConfig, error, node.readCount);
                    done(error);
                });
            });

        } else if (version === VERSION_18_FLUX || version === VERSION_20) {
            // LucaT: Gestione dinamica dell'organizzazione per supportare override
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
                    updateNodeStatus(node, node.influxdbConfig, node.readCount);
                    return done(RED._("influxdb.errors.noquery"));
                }
                var output = [];
                node.client.queryRows(query, {
                    next(row, tableMeta) {
                        var o = tableMeta.toObject(row)
                        output.push(o);
                    },
                    error(error) {
                        msg.influx_error = createInfluxError(error);
                        showTemporaryError(node, node.influxdbConfig, error, node.readCount);
                        done(error);
                    },
                    complete() {
                        msg.payload = output;
                        send(msg);
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
