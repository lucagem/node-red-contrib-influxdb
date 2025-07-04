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
     * LucaT: Helper functions per gestire gli override dei parametri Version 2.0
     */
    function getDynamicUrl2x(dynamicUrl2x) {
        if (!dynamicUrl2x || dynamicUrl2x.trim() === "" || isEnvironmentVariable(dynamicUrl2x)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicUrl2x.trim();
        // Verifica che sia un URL valido
        if (trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")) {
            return trimmedValue;
        }
        return null; // Non intervenire se non è un URL valido
    }
    function getDynamicToken2x(dynamicToken2x) {
        if (!dynamicToken2x || dynamicToken2x.trim() === "" || isEnvironmentVariable(dynamicToken2x)) {
            return null; // Non intervenire
        }
        return dynamicToken2x.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicTimeout2x(dynamicTimeout2x) {
        if (!dynamicTimeout2x || dynamicTimeout2x.trim() === "" || isEnvironmentVariable(dynamicTimeout2x)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicTimeout2x.trim();
        // Verifica che sia un numero valido
        const timeoutValue = parseInt(trimmedValue);
        if (!isNaN(timeoutValue) && timeoutValue > 0) {
            return trimmedValue;
        }
        return null; // Non intervenire se non è un numero valido
    }

    /**
     * LucaT: Helper functions per gestire gli override dei parametri Version 1.8-flux  
     */
    function getDynamicUrl18Flux(dynamicUrl18Flux) {
        if (!dynamicUrl18Flux || dynamicUrl18Flux.trim() === "" || isEnvironmentVariable(dynamicUrl18Flux)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicUrl18Flux.trim();
        // Verifica che sia un URL valido
        if (trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")) {
            return trimmedValue;
        }
        return null; // Non intervenire se non è un URL valido
    }
    function getDynamicUsername18Flux(dynamicUsername18Flux) {
        if (!dynamicUsername18Flux || dynamicUsername18Flux.trim() === "" || isEnvironmentVariable(dynamicUsername18Flux)) {
            return null; // Non intervenire
        }
        return dynamicUsername18Flux.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicPassword18Flux(dynamicPassword18Flux) {
        if (!dynamicPassword18Flux || dynamicPassword18Flux.trim() === "" || isEnvironmentVariable(dynamicPassword18Flux)) {
            return null; // Non intervenire
        }
        return dynamicPassword18Flux.trim(); // Accetta qualsiasi valore (anche stringa vuota dopo trim)
    }

    /**
     * LucaT: Helper functions per gestire gli override dei parametri Version 1.0
     */
    function getDynamicHostname1x(dynamicHostname1x) {
        if (!dynamicHostname1x || dynamicHostname1x.trim() === "" || isEnvironmentVariable(dynamicHostname1x)) {
            return null; // Non intervenire
        }
        return dynamicHostname1x.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicPort1x(dynamicPort1x) {
        if (!dynamicPort1x || dynamicPort1x.trim() === "" || isEnvironmentVariable(dynamicPort1x)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicPort1x.trim();
        // Verifica che sia un numero valido
        const portValue = parseInt(trimmedValue);
        if (!isNaN(portValue) && portValue > 0 && portValue <= 65535) {
            return portValue; // Restituisce come numero per InfluxDB 1.0
        }
        return null; // Non intervenire se non è un numero valido
    }
    function getDynamicDatabase1x(dynamicDatabase1x) {
        if (!dynamicDatabase1x || dynamicDatabase1x.trim() === "" || isEnvironmentVariable(dynamicDatabase1x)) {
            return null; // Non intervenire
        }
        return dynamicDatabase1x.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicUsername1x(dynamicUsername1x) {
        if (!dynamicUsername1x || dynamicUsername1x.trim() === "" || isEnvironmentVariable(dynamicUsername1x)) {
            return null; // Non intervenire
        }
        return dynamicUsername1x.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicPassword1x(dynamicPassword1x) {
        if (!dynamicPassword1x || dynamicPassword1x.trim() === "" || isEnvironmentVariable(dynamicPassword1x)) {
            return null; // Non intervenire
        }
        return dynamicPassword1x.trim(); // Accetta qualsiasi valore (anche stringa vuota dopo trim)
    }

    /**
     * LucaT: Helper functions per gestire gli override dei parametri del nodo OUT
     */
    function getDynamicMeasurement(dynamicMeasurement) {
        if (!dynamicMeasurement || dynamicMeasurement.trim() === "" || isEnvironmentVariable(dynamicMeasurement)) {
            return null; // Non intervenire
        }
        return dynamicMeasurement.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicDatabase(dynamicDatabase) {
        if (!dynamicDatabase || dynamicDatabase.trim() === "" || isEnvironmentVariable(dynamicDatabase)) {
            return null; // Non intervenire
        }
        return dynamicDatabase.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicRetentionPolicy(dynamicRetentionPolicy) {
        if (!dynamicRetentionPolicy || dynamicRetentionPolicy.trim() === "" || isEnvironmentVariable(dynamicRetentionPolicy)) {
            return null; // Non intervenire
        }
        return dynamicRetentionPolicy.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicOrg(dynamicOrg) {
        if (!dynamicOrg || dynamicOrg.trim() === "" || isEnvironmentVariable(dynamicOrg)) {
            return null; // Non intervenire
        }
        return dynamicOrg.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicBucket(dynamicBucket) {
        if (!dynamicBucket || dynamicBucket.trim() === "" || isEnvironmentVariable(dynamicBucket)) {
            return null; // Non intervenire
        }
        return dynamicBucket.trim(); // Accetta qualsiasi valore non vuoto
    }
    function getDynamicPrecision(dynamicPrecision) {
        if (!dynamicPrecision || dynamicPrecision.trim() === "" || isEnvironmentVariable(dynamicPrecision)) {
            return null; // Non intervenire
        }
        const trimmedValue = dynamicPrecision.trim();
        // Verifica che sia un valore di precisione valido
        const validPrecisions = ['ns', 'us', 'ms', 's', 'n', 'u', 'm', 'h', 'd', 'w'];
        if (validPrecisions.includes(trimmedValue)) {
            return trimmedValue;
        }
        return null; // Non intervenire se non è un valore valido
    }

    /**
     * LucaT - Helper function per capire se un valore è una variabile di ambiente
     */    
    function isEnvironmentVariable(value) {
        // Controlla se il valore è una variabile di ambiente
        // per evitare che ci siano variabilidi ambiente non risolte
        if (value && typeof value === 'string' && value.startsWith("${") && value.endsWith("}")) {
            // scrive un log di debug per c'è una variabile di ambiente non risolta
            RED.log.debug(`Detected environment variable NOT SOLVED: ${value}`);
            return true; // È una variabile di ambiente
        } else {
            return false; // Non è una variabile di ambiente
        }
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

        // LucaT: Gestione version override (INIZIO) - sostituisce il valore originale se necessario
        const dynamicVersionOverride = getDynamicVersion(n.dynamicVersion);
        if (dynamicVersionOverride !== null) {
            const originalVersion = n.influxdbVersion;
            n.influxdbVersion = dynamicVersionOverride;
            // Log del cambiamento
            RED.log.info(`InfluxDb dynamic override version changed from [${originalVersion}] to [${n.influxdbVersion}]`);
        }
        if (n.influxdbVersion === VERSION_1X) {
            // LucaT: Gestione override parametri specifici per Version 1.0 - DA TESTARE
            // Override Hostname per 1.0
            const dynamicHostname1xOverride = getDynamicHostname1x(n.dynamicHostname1x);
            if (dynamicHostname1xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Hostname (1.0) changed from [${this.hostname}] to [${dynamicHostname1xOverride}]`);
                this.hostname = dynamicHostname1xOverride;
            }
            // Override Port per 1.0
            const dynamicPort1xOverride = getDynamicPort1x(n.dynamicPort1x);
            if (dynamicPort1xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Port (1.0) changed from [${this.port}] to [${dynamicPort1xOverride}]`);
                this.port = dynamicPort1xOverride;
            }
            // Override Database per 1.0
            const dynamicDatabase1xOverride = getDynamicDatabase1x(n.dynamicDatabase1x);
            if (dynamicDatabase1xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Database (1.0) changed from [${this.database}] to [${dynamicDatabase1xOverride}]`);
                this.database = dynamicDatabase1xOverride;
            }
            // Override Username per 1.0
            const dynamicUsername1xOverride = getDynamicUsername1x(n.dynamicUsername1x);
            if (dynamicUsername1xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Username (1.0) changed (hidden for security)`);
                // Lo username verrà gestito nella sezione credentials più avanti
            }
            // Override Password per 1.0
            const dynamicPassword1xOverride = getDynamicPassword1x(n.dynamicPassword1x);
            if (dynamicPassword1xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Password (1.0) changed (hidden for security)`);
                // La password verrà gestita nella sezione credentials più avanti
            }
        } else if (n.influxdbVersion === VERSION_18_FLUX) {
            // LucaT: Gestione override parametri specifici per Version 1.8-flux
            // Override URL per 1.8-flux
            const dynamicUrl18FluxOverride = getDynamicUrl18Flux(n.dynamicUrl18Flux);
            if (dynamicUrl18FluxOverride !== null) {
                RED.log.info(`InfluxDb dynamic override URL (1.8-flux) changed from [${n.url}] to [${dynamicUrl18FluxOverride}]`);
                n.url = dynamicUrl18FluxOverride;
            }
            // Override Username per 1.8-flux
            const dynamicUsername18FluxOverride = getDynamicUsername18Flux(n.dynamicUsername18Flux);
            if (dynamicUsername18FluxOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Username (1.8-flux) changed (hidden for security)`);
                // Lo username verrà gestito nella sezione credentials più avanti
            }
            // Override Password per 1.8-flux
            const dynamicPassword18FluxOverride = getDynamicPassword18Flux(n.dynamicPassword18Flux);
            if (dynamicPassword18FluxOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Password (1.8-flux) changed (hidden for security)`);
                // La password verrà gestita nella sezione credentials più avanti
            }
        } else if (n.influxdbVersion === VERSION_20) {
            // LucaT: Gestione override parametri specifici per Version 2.0
            // Override URL
            const dynamicUrlOverride = getDynamicUrl2x(n.dynamicUrl2x);
            if (dynamicUrlOverride !== null) {
                RED.log.info(`InfluxDb dynamic override URL changed from [${n.url}] to [${dynamicUrlOverride}]`);
                n.url = dynamicUrlOverride;
            }
            // Override Token (viene gestito nelle credentials)
            const dynamicTokenOverride = getDynamicToken2x(n.dynamicToken2x);
            if (dynamicTokenOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Token changed (hidden for security)`);
                // Il token verrà gestito nella sezione credentials più avanti
            }
            // Override Timeout
            const dynamicTimeout2xOverride = getDynamicTimeout2x(n.dynamicTimeout2x);
            if (dynamicTimeout2xOverride !== null) {
                RED.log.info(`InfluxDb dynamic override Timeout changed from [${n.timeout}] to [${dynamicTimeout2xOverride}]`);
                n.timeout = dynamicTimeout2xOverride;
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

            // LucaT: DA TESTARE (INIZIO) Gestione override delle credenziali per VERSION_1X
            let username = this.credentials.username;
            let password = this.credentials.password;
            const dynamicUsername1xOverride = getDynamicUsername1x(n.dynamicUsername1x);
            if (dynamicUsername1xOverride !== null) {
                username = dynamicUsername1xOverride;
            }
            const dynamicPassword1xOverride = getDynamicPassword1x(n.dynamicPassword1x);
            if (dynamicPassword1xOverride !== null) {
                password = dynamicPassword1xOverride;
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
            // LucaT: DA TESTARE (FINE) Gestione override delle credenziali per VERSION_1X

        } else if (n.influxdbVersion === VERSION_18_FLUX || n.influxdbVersion === VERSION_20) {
            const timeout = Math.floor(+(n.timeout ? n.timeout : 10) * 1000) // convert from seconds to milliseconds
            // LucaT: Gestione override delle credenziali prottette
            let token;
            if (n.influxdbVersion === VERSION_18_FLUX) {
                // VERSION_18_FLUX - controlla se ci sono override per username/password
                let username = this.credentials.username;
                let password = this.credentials.password;
                const dynamicUsername18FluxOverride = getDynamicUsername18Flux(n.dynamicUsername18Flux);
                if (dynamicUsername18FluxOverride !== null) {
                    username = dynamicUsername18FluxOverride;
                }
                const dynamicPassword18FluxOverride = getDynamicPassword18Flux(n.dynamicPassword18Flux);
                if (dynamicPassword18FluxOverride !== null) {
                    password = dynamicPassword18FluxOverride;
                }
                token = `${username}:${password}`;
            } else {
                // VERSION_20 - controlla se c'è un override del token
                const dynamicTokenOverride = getDynamicToken2x(n.dynamicToken2x);
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
        // LucaT: Dynamic Properties per nodo OUT
        this.dynamicMeasurement = n.dynamicMeasurement;
        this.dynamicDatabase = n.dynamicDatabase;
        this.dynamicRetentionPolicyV18Flux = n.dynamicRetentionPolicyV18Flux;
        this.dynamicOrg = n.dynamicOrg;
        this.dynamicBucket = n.dynamicBucket;
        this.dynamicPrecision = n.dynamicPrecision;

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
            // LucaT: Aggiunto supporto per il bucket dinamico (INIZIO)
            let bucket;
            let org;
            if (version === VERSION_18_FLUX) {
                // Per 1.8-flux, il bucket è sempre database/retention
                let retentionPolicy = this.retentionPolicyV18Flux ? this.retentionPolicyV18Flux : 'autogen';
                bucket = `${this.database}/${retentionPolicy}`;
                org = '';
            } else {
                // Per 2.0, usa i valori dinamici se disponibili
                bucket = this.bucket;
                org = this.org;
            }
            this.client = this.influxdbConfig.client.getWriteApi(org, bucket, this.precisionV18FluxV20);
            // LucaT: Aggiunto supporto per il bucket dinamico (FINE)

            node.on("input", function (msg, send, done) {
                // LucaT: Controlla se la connessione è abilitata
                if (!node.influxdbConfig.isConnectionEnabled()) {
                    // Se disabilitato, aggiorna lo status e ignora silenziosamente
                    updateNodeStatus(node, node.influxdbConfig);
                    done();
                    return;
                }
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

            // LucaT: Aggiunta variabile per conteggio operazioni di scrittura
            node.writeCount = 0;
            // LucaT: Inizializza lo status del nodo basato su dynamicEnabled
            updateNodeStatus(node, node.influxdbConfig, node.writeCount);

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
                } else {
                    // LucaT: Ripristina status a "ready" se non ci sono dati da scrivere
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

                // LucaT: Modificata la gestione bucket e org per supportare dinamicamente le versioni 1.8-flux e 2.0
                let bucket;
                let org;
                if (version === VERSION_18_FLUX) {
                    // Per 1.8-flux, il bucket è sempre database/retention
                    let retentionPolicy = node.retentionPolicyV18Flux ? node.retentionPolicyV18Flux : 'autogen';
                    bucket = `${node.database}/${retentionPolicy}`;
                    org = '';
                } else {
                    // Per 2.0, usa i valori dinamici se disponibili - RIVALUTA AD OGNI MESSAGGIO
                    bucket = node.bucket;
                    org = node.org;
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
                            // LucaT: usa createInfluxError per standardizzare l'errore
                            msg.influx_error = createInfluxError(new Error("Fields are required"));
                            // LucaT: Ripristina status a "ready" dopo l'errore
                            updateNodeStatus(node, node.influxdbConfig, node.writeCount);
                            return done(new Error("Fields are required"));
                        }

                        // The value of element.timestamp will be used even if it is
                        // undefined, however the Point library will handle that to set the
                        // timestamp to be the current timestamp.
                        // If the timestamp is provided in the payload then this will
                        // be overridden by the timestamp below.
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
                } else {
                    // LucaT: Ripristina status a "ready" se non ci sono dati da scrivere
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
