/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/geo_duels.json`.
 */
export type GeoDuels = {
  "address": "2Cju35ZeK1ZV5VZnn99LFS7tt8Vh3rkBQG6TZYirz5Et",
  "metadata": {
    "name": "geoDuels",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Geo Duels: VRF-dropped geo guessing with sealed guesses on a MagicBlock Private Ephemeral Rollup"
  },
  "instructions": [
    {
      "name": "callbackSetLocation",
      "docs": [
        "VRF callback: pick a pool entry + jitter, then start the clock."
      ],
      "discriminator": [
        239,
        61,
        28,
        81,
        172,
        72,
        201,
        38
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "game",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "cancelGame",
      "docs": [
        "Host cancels before the round goes live (lobby, or VRF never answered):",
        "everyone gets their stake back. `remaining_accounts` = player wallets in",
        "join order."
      ],
      "discriminator": [
        121,
        194,
        154,
        118,
        103,
        235,
        149,
        52
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createGame",
      "docs": [
        "Open a lobby. The host auto-joins as player 0 and stakes."
      ],
      "discriminator": [
        124,
        69,
        75,
        66,
        184,
        220,
        72,
        206
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "guess",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  117,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              },
              {
                "kind": "account",
                "path": "host"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "SOL escrow, system-owned, never delegated."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "maxPlayers",
          "type": "u8"
        },
        {
          "name": "guessSecs",
          "type": "u32"
        }
      ]
    },
    {
      "name": "delegatePda",
      "docs": [
        "Delegate a guess PDA (any time) or the game PDA (only once the location",
        "is live, so the lobby can't be frozen early) to the ER validator."
      ],
      "discriminator": [
        248,
        217,
        193,
        46,
        124,
        191,
        64,
        135
      ],
      "accounts": [
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                17,
                221,
                148,
                110,
                118,
                98,
                148,
                163,
                106,
                39,
                221,
                101,
                26,
                231,
                21,
                105,
                202,
                213,
                250,
                166,
                108,
                69,
                12,
                30,
                182,
                144,
                179,
                241,
                58,
                188,
                67,
                13
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "validator",
          "optional": true
        },
        {
          "name": "ownerProgram",
          "address": "2Cju35ZeK1ZV5VZnn99LFS7tt8Vh3rkBQG6TZYirz5Et"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountType",
          "type": {
            "defined": {
              "name": "accountType"
            }
          }
        }
      ]
    },
    {
      "name": "initPermission",
      "docs": [
        "ER: create the ephemeral permission for a delegated PDA. The PDA pays",
        "its own rent (pre-funded on the base layer) and signs via its seeds.",
        "`members = Some(list)` → private to that list, `None` → public."
      ],
      "discriminator": [
        66,
        14,
        153,
        250,
        187,
        36,
        179,
        236
      ],
      "accounts": [
        {
          "name": "permissionedAccount",
          "writable": true
        },
        {
          "name": "permission",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountType",
          "type": {
            "defined": {
              "name": "accountType"
            }
          }
        },
        {
          "name": "members",
          "type": {
            "option": {
              "vec": {
                "defined": {
                  "name": "member"
                }
              }
            }
          }
        }
      ]
    },
    {
      "name": "joinGame",
      "docs": [
        "Join an open lobby and match the stake."
      ],
      "discriminator": [
        107,
        112,
        18,
        38,
        56,
        173,
        60,
        128
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "guess",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  117,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "payout",
      "docs": [
        "Pay out the pot once the revealed game is back on the base layer. Split",
        "evenly between tied winners (dust to the first); if nobody guessed,",
        "everyone is refunded. Permissionless — funds only go to recorded players.",
        "`remaining_accounts` = player wallets (writable) in join order."
      ],
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "releaseGuess",
      "docs": [
        "ER cleanup after the reveal: commit + undelegate a revealed guess PDA so",
        "its rent isn't stranded on the rollup. Kept separate from the reveal so",
        "each commit stays small. Anyone can call it once the round is revealed."
      ],
      "discriminator": [
        236,
        14,
        158,
        170,
        182,
        4,
        52,
        247
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "guess",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  117,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "guess.game_id",
                "account": "guess"
              },
              {
                "kind": "account",
                "path": "guess.player",
                "account": "guess"
              }
            ]
          }
        },
        {
          "name": "game",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "guess.game_id",
                "account": "guess"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "revealAndSettle",
      "docs": [
        "ER: once everyone has locked in (or the clock ran out) anyone can reveal.",
        "Copies each sealed guess into the public game account, scores it, picks",
        "the closest guess(es) as winner(s), then commits + undelegates the game",
        "back to the base layer for payout.",
        "`remaining_accounts` = guess PDAs in join order."
      ],
      "discriminator": [
        109,
        135,
        160,
        152,
        80,
        87,
        25,
        104
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startGame",
      "docs": [
        "Host locks the lobby and asks the VRF oracle for the drop location.",
        "Nobody — the host included — can know the spot before the callback lands."
      ],
      "discriminator": [
        249,
        47,
        252,
        172,
        184,
        162,
        245,
        14
      ],
      "accounts": [
        {
          "name": "host",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.game_id",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "clientSeed",
          "type": "u8"
        }
      ]
    },
    {
      "name": "submitGuess",
      "docs": [
        "ER: lock in a sealed guess (micro-degrees). One shot, before the deadline."
      ],
      "discriminator": [
        61,
        124,
        32,
        227,
        64,
        198,
        252,
        3
      ],
      "accounts": [
        {
          "name": "game",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "guess",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  101,
                  111,
                  95,
                  103,
                  117,
                  101,
                  115,
                  115
                ]
              },
              {
                "kind": "arg",
                "path": "gameId"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "gameId",
          "type": "u64"
        },
        {
          "name": "lat",
          "type": "i32"
        },
        {
          "name": "lng",
          "type": "i32"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "game",
      "discriminator": [
        27,
        90,
        166,
        125,
        74,
        100,
        121,
        18
      ]
    },
    {
      "name": "guess",
      "discriminator": [
        199,
        136,
        162,
        22,
        201,
        176,
        249,
        195
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badMaxPlayers",
      "msg": "max_players must be between 1 and 10"
    },
    {
      "code": 6001,
      "name": "badGuessTime",
      "msg": "Guess time must be between 15 and 600 seconds"
    },
    {
      "code": 6002,
      "name": "lobbyClosed",
      "msg": "The lobby is closed"
    },
    {
      "code": 6003,
      "name": "gameFull",
      "msg": "The lobby is full"
    },
    {
      "code": 6004,
      "name": "alreadyJoined",
      "msg": "You already joined this game"
    },
    {
      "code": 6005,
      "name": "notHost",
      "msg": "Only the host can do this"
    },
    {
      "code": 6006,
      "name": "wrongPhase",
      "msg": "Wrong game phase for this action"
    },
    {
      "code": 6007,
      "name": "timeUp",
      "msg": "Time is up"
    },
    {
      "code": 6008,
      "name": "badCoordinates",
      "msg": "Coordinates out of range"
    },
    {
      "code": 6009,
      "name": "alreadyGuessed",
      "msg": "You already locked in a guess"
    },
    {
      "code": 6010,
      "name": "roundStillOpen",
      "msg": "Players are still guessing"
    },
    {
      "code": 6011,
      "name": "wrongPlayerAccounts",
      "msg": "Player accounts don't match the game"
    },
    {
      "code": 6012,
      "name": "wrongPda",
      "msg": "Account does not match its seeds"
    },
    {
      "code": 6013,
      "name": "alreadyPaid",
      "msg": "The pot has already been paid"
    },
    {
      "code": 6014,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "accountType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "game",
            "fields": [
              {
                "name": "gameId",
                "type": "u64"
              }
            ]
          },
          {
            "name": "guess",
            "fields": [
              {
                "name": "gameId",
                "type": "u64"
              },
              {
                "name": "player",
                "type": "pubkey"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "game",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "u64"
          },
          {
            "name": "host",
            "type": "pubkey"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "maxPlayers",
            "type": "u8"
          },
          {
            "name": "guessSecs",
            "type": "u32"
          },
          {
            "name": "phase",
            "type": {
              "defined": {
                "name": "phase"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "locationIndex",
            "type": "u16"
          },
          {
            "name": "targetLat",
            "type": "i32"
          },
          {
            "name": "targetLng",
            "type": "i32"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "revealedAt",
            "type": "i64"
          },
          {
            "name": "winnerMask",
            "type": "u16"
          },
          {
            "name": "paid",
            "type": "bool"
          },
          {
            "name": "players",
            "type": {
              "vec": {
                "defined": {
                  "name": "playerSlot"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "guess",
      "docs": [
        "A player's sealed guess. Lives on the ER behind a private permission, so",
        "only its owner can read it until `reveal_and_settle` copies it into the game."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "gameId",
            "type": "u64"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "lat",
            "type": "i32"
          },
          {
            "name": "lng",
            "type": "i32"
          },
          {
            "name": "submitted",
            "type": "bool"
          },
          {
            "name": "submittedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "member",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "flags",
            "type": "u8"
          },
          {
            "name": "pubkey",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "phase",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "lobby"
          },
          {
            "name": "locating"
          },
          {
            "name": "guessing"
          },
          {
            "name": "revealed"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "playerSlot",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "guessed",
            "type": "bool"
          },
          {
            "name": "lat",
            "type": "i32"
          },
          {
            "name": "lng",
            "type": "i32"
          },
          {
            "name": "distanceM",
            "type": "u32"
          },
          {
            "name": "guessedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
