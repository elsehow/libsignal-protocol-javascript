var SessionRecord = require('../src/SessionRecord.js');
var KeyHelper = require('../src/KeyHelper.js');
var SessionCipher = require('../src/SessionCipher.js');
var SessionBuilder = require('../src/SessionBuilder.js');
var SignalProtocolAddress = require('../src/SignalProtocolAddress.js');
var util = require('../src/helpers.js');

var SignalProtocolStore = require('./InMemorySignalProtocolStore.js');

describe('SessionBuilder', function() {
    this.timeout(5000);
    // var KeyHelper = KeyHelper;

    function generateIdentity(store) {
        return Promise.all([
            KeyHelper.generateIdentityKeyPair(),
            KeyHelper.generateRegistrationId(),
        ]).then(function(result) {
            store.put('identityKey', result[0]);
            store.put('registrationId', result[1]);
        });
    }

    function generatePreKeyBundle(store, preKeyId, signedPreKeyId) {
        return Promise.all([
            store.getIdentityKeyPair(),
            store.getLocalRegistrationId()
        ]).then(function(result) {
            var identity = result[0];
            var registrationId = result[1];

            return Promise.all([
                KeyHelper.generatePreKey(preKeyId),
                KeyHelper.generateSignedPreKey(identity, signedPreKeyId),
            ]).then(function(keys) {
                var preKey = keys[0]
                var signedPreKey = keys[1];

                store.storePreKey(preKeyId, preKey.keyPair);
                store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

                return {
                    identityKey: identity.pubKey,
                    registrationId : registrationId,
                    preKey:  {
                        keyId     : preKeyId,
                        publicKey : preKey.keyPair.pubKey
                    },
                    signedPreKey: {
                        keyId     : signedPreKeyId,
                        publicKey : signedPreKey.keyPair.pubKey,
                        signature : signedPreKey.signature
                    }
                };
            });
        });
    }

    var ALICE_ADDRESS = new SignalProtocolAddress("+14151111111", 1);
    var BOB_ADDRESS   = new SignalProtocolAddress("+14152222222", 1);

    describe("basic prekey v3", function() {
        var aliceStore = new SignalProtocolStore();

        var bobStore = new SignalProtocolStore();
        var bobPreKeyId = 1337;
        var bobSignedKeyId = 1;

        var Curve = require('../src/Curve.js').Curve;

        before(function(done) {
            Promise.all([
                generateIdentity(aliceStore),
                generateIdentity(bobStore),
            ]).then(function() {
                return generatePreKeyBundle(bobStore, bobPreKeyId, bobSignedKeyId);
            }).then(function(preKeyBundle) {
                var builder = new SessionBuilder(aliceStore, BOB_ADDRESS);
                return builder.processPreKey(preKeyBundle).then(function() {
                    done();
                });
            }).catch(done);
        });

        var originalMessage = util.toArrayBuffer("L'homme est condamné à être libre");
        var aliceSessionCipher = new SessionCipher(aliceStore, BOB_ADDRESS);
        var bobSessionCipher = new SessionCipher(bobStore, ALICE_ADDRESS);

        it('creates a session', function(done) {
            return aliceStore.loadSession(BOB_ADDRESS.toString()).then(function(record) {
                assert.isDefined(record);
                var sessionRecord = SessionRecord.deserialize(record);
                assert.isTrue(sessionRecord.haveOpenSession());
                assert.isDefined(sessionRecord.getOpenSession());
            }).then(done, done);
        });

        it('the session can encrypt', function(done) {
            aliceSessionCipher.encrypt(originalMessage).then(function(ciphertext) {

                assert.strictEqual(ciphertext.type, 3); // PREKEY_BUNDLE

                return bobSessionCipher.decryptPreKeyWhisperMessage(ciphertext.body, 'binary');

            }).then(function(plaintext) {

                assertEqualArrayBuffers(plaintext, originalMessage);

            }).then(done, done);
        });

        it('the session can decrypt', function(done) {
            bobSessionCipher.encrypt(originalMessage).then(function(ciphertext) {

                return aliceSessionCipher.decryptWhisperMessage(ciphertext.body, 'binary');

            }).then(function(plaintext) {

                assertEqualArrayBuffers(plaintext, originalMessage);

            }).then(done, done);
        });

        it('accepts a new preKey with the same identity', function(done) {
            generatePreKeyBundle(bobStore, bobPreKeyId + 1, bobSignedKeyId + 1).then(function(preKeyBundle) {
                var builder = new SessionBuilder(aliceStore, BOB_ADDRESS);
                return builder.processPreKey(preKeyBundle).then(function() {
                    return aliceStore.loadSession(BOB_ADDRESS.toString()).then(function(record) {
                        assert.isDefined(record);
                        var sessionRecord = SessionRecord.deserialize(record);
                        assert.isTrue(sessionRecord.haveOpenSession());
                        assert.isDefined(sessionRecord.getOpenSession());
                        done();
                    });
                });
            }).catch(done);
        });

        it('rejects untrusted identity keys', function(done) {
            KeyHelper.generateIdentityKeyPair().then(function(newIdentity) {
                var builder = new SessionBuilder(aliceStore, BOB_ADDRESS);
                return builder.processPreKey({
                    identityKey: newIdentity.pubKey,
                    registrationId : 12356
                }).then(function(e) {
                    assert.fail('should not be trusted');
                }).catch(function(e) {
                    assert.strictEqual(e.message, 'Identity key changed');
                    done();
                }).catch(done);
            });
        });
    });
});
