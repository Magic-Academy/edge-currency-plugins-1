import * as bip32 from 'bip32'
import { BIP32Interface } from 'bip32'
import * as bip39 from 'bip39'
import * as bitcoin from 'bitcoinjs-lib'

import {
  cashAddressToHash,
  cashaddrPrefixEnum,
  cashaddrTypeEnum,
  hashToCashAddress
} from './bitcoincashUtils/cashAddress'
import { Coin, CoinPrefixes } from './coin'
import { getCoinFromString } from './coinmapper'

// this enumerates the network types of single coins. Can be expanded to add regtest, signet, stagenet etc.
export enum NetworkEnum {
  Mainnet = 'mainnet',
  Testnet = 'testnet'
}

// in bitcoin these are bip44, bip49, bip84 xpub prefixes
// other coins contain different formats which still need to be gathered.
export enum BIP43PurposeTypeEnum {
  Legacy = 'legacy', // xpub/xprv tpub/tprv etc.
  Segwit = 'segwit', // zpub/zprv vpub/vprv etc.
  WrappedSegwit = 'wrappedSegwit' // ypub/yprv upub/uprv etc.
}

// supported address types.
export enum AddressTypeEnum {
  p2pkh = 'p2pkh',
  p2sh = 'p2sh',
  p2wpkhp2sh = 'p2wpkhp2sh',
  p2wpkh = 'p2wpkh',
  p2wsh = 'p2wsh',
  p2wshp2sh = 'p2wshp2sh',
  cashaddrP2PKH = 'cashaddrP2PKH',
  cashaddrP2SH = 'cashaddrP2SH'
}

// A transaction input is either legacy or segwit. This is used for transaction creation and passed per input
export enum TransactionInputTypeEnum {
  Legacy = 'legacy',
  Segwit = 'segwit'
}

export interface MnemonicToXPrivArgs {
  mnemonic: string
  path: string
  network: NetworkEnum
  type: BIP43PurposeTypeEnum
  coin: string
}

export interface XPrivToXPubArgs {
  xpriv: string
  network: NetworkEnum
  type: BIP43PurposeTypeEnum
  coin: string
}

export interface XPrivToPrivateKeyArgs {
  xpriv: string
  network: NetworkEnum
  type: BIP43PurposeTypeEnum
  bip44ChangeIndex: 0 | 1
  bip44AddressIndex: number
  coin: string
}

export interface XPubToPubkeyArgs {
  xpub: string
  network: NetworkEnum
  type: BIP43PurposeTypeEnum
  bip44ChangeIndex: 0 | 1
  bip44AddressIndex: number
  coin: string
}

export interface AddressToScriptPubkeyArgs {
  address: string
  network: NetworkEnum
  addressType?: AddressTypeEnum
  coin: string
}

export interface PubkeyToScriptPubkeyArgs {
  pubkey: string
  addressType: AddressTypeEnum
}

export interface PubkeyToScriptPubkeyReturn {
  scriptPubkey: string
  redeemScript?: string
}

export interface ScriptPubkeyToAddressArgs {
  scriptPubkey: string
  addressType: AddressTypeEnum
  network: NetworkEnum
  coin: string
}

// Careful! Calling this the ScriptHash is only correct for p2sh addresses.
// For p2pkh and p2wpkh this is just the pubkey hash.
// To get the script hash as used by electrum servers, follow their docs here:
// https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
// and use to scriptPubkeyToElectrumScriptHash function
export interface ScriptPubkeyToScriptHashArgs {
  scriptPubkey: string
  addressType: AddressTypeEnum
  network: NetworkEnum
  coin: string
}

interface ScriptHashToScriptPubkeyArgs {
  scriptHash: string
  addressType: AddressTypeEnum
  network: NetworkEnum
  coin: string
}

export interface WIFToPrivateKeyArgs {
  wifKey: string
  network: NetworkEnum
  coin: string
}

export interface PrivateKeyToWIFArgs {
  privateKey: string
  network: NetworkEnum
  coin: string
}

export interface TxInput {
  type: TransactionInputTypeEnum
  prevTxid: string
  index: number
  prevTx?: string // required for legacy transactions
  prevScriptPubkey?: string // required for segwit transactions
  redeemScript?: string // required for p2sh transaction such as wrapped segwit
  value?: number // required for segwit transactions
}

export interface TxOutput {
  scriptPubkey: string
  amount: number
}

export interface CreateTxArgs {
  network: NetworkEnum
  inputs: TxInput[]
  outputs: TxOutput[]
  rbf: boolean
}

export interface SignTxArgs {
  privateKeys: string[]
  tx: string
}

// BitcoinJSNetwork and Bip32 are the same interfaces as declared in  bitcoin-js ts_src/network.ts
// We redeclare them here for transparency reasons
interface BitcoinJSNetwork {
  wif: number
  bip32: Bip32
  messagePrefix: string
  bech32: string
  pubKeyHash: number
  scriptHash: number
}

interface Bip32 {
  public: number
  private: number
}

function bip32NetworkFromCoinPrefix(
  sigType: BIP43PurposeTypeEnum,
  coinPrefixes: CoinPrefixes,
  segwit: Boolean
): BitcoinJSNetwork {
  let xKeyPrefixes: Bip32
  switch (sigType) {
    case BIP43PurposeTypeEnum.Segwit:
      if (
        typeof coinPrefixes.segwitXPub === 'undefined' ||
        typeof coinPrefixes.segwitXPriv === 'undefined'
      ) {
        throw new Error('segwit xpub prefix is undefined')
      }
      xKeyPrefixes = {
        public: coinPrefixes.segwitXPub,
        private: coinPrefixes.segwitXPriv
      }
      break
    case BIP43PurposeTypeEnum.WrappedSegwit:
      if (
        typeof coinPrefixes.wrappedSegwitXPub === 'undefined' ||
        typeof coinPrefixes.wrappedSegwitXPriv === 'undefined'
      ) {
        throw new Error('wrapped segwit xpub prefix is undefined')
      }
      xKeyPrefixes = {
        public: coinPrefixes.wrappedSegwitXPub,
        private: coinPrefixes.wrappedSegwitXPriv
      }
      break
    case BIP43PurposeTypeEnum.Legacy:
      xKeyPrefixes = {
        public: coinPrefixes.legacyXPub,
        private: coinPrefixes.legacyXPriv
      }
      break
    default:
      throw new Error('invalid bip43 purpose type')
  }

  const bech32: string = coinPrefixes.bech32 ?? 'bc'

  return {
    messagePrefix: coinPrefixes.messagePrefix,
    wif: coinPrefixes.wif,
    bip32: xKeyPrefixes,
    bech32: bech32,
    pubKeyHash: coinPrefixes.pubkeyHash,
    scriptHash: coinPrefixes.scriptHash
  }
}

function bip32NetworkFromCoin(
  networkType: NetworkEnum,
  coinString: string,
  sigType: BIP43PurposeTypeEnum = BIP43PurposeTypeEnum.Legacy
): BitcoinJSNetwork {
  const coin: Coin = getCoinFromString(coinString)
  if (networkType === NetworkEnum.Testnet) {
    return bip32NetworkFromCoinPrefix(
      sigType,
      coin.testnetConstants,
      coin.segwit
    )
  }
  return bip32NetworkFromCoinPrefix(sigType, coin.mainnetConstants, coin.segwit)
}

function guessAddressTypeFromAddress(
  address: string,
  network: BitcoinJSNetwork,
  addressType: AddressTypeEnum | undefined
): AddressTypeEnum {
  if (typeof addressType !== 'undefined') {
    return addressType
  }
  try {
    bitcoin.payments.p2pkh({ address, network })
    return AddressTypeEnum.p2pkh
  } catch (e) {}
  try {
    bitcoin.payments.p2sh({ address, network })
    return AddressTypeEnum.p2sh
  } catch (e) {}
  try {
    bitcoin.payments.p2wsh({ address, network })
    return AddressTypeEnum.p2wsh
  } catch (e) {}
  try {
    bitcoin.payments.p2wpkh({ address, network })
    return AddressTypeEnum.p2wpkh
  } catch (e) {}
  try {
    const info = cashAddressToHash(address)
    if (info.type === cashaddrTypeEnum.pubkeyhash) {
      return AddressTypeEnum.cashaddrP2PKH
    }
    return AddressTypeEnum.cashaddrP2SH
  } catch (e) {}

  throw new Error('Could not determine address type of ' + address)
}

export function mnemonicToXPriv(
  mnemonicToXPrivArgs: MnemonicToXPrivArgs
): string {
  const seed = bip39.mnemonicToSeedSync(mnemonicToXPrivArgs.mnemonic)
  const root: BIP32Interface = bip32.fromSeed(seed)
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    mnemonicToXPrivArgs.network,
    mnemonicToXPrivArgs.coin,
    mnemonicToXPrivArgs.type
  )
  root.network = network
  const child: BIP32Interface = root.derivePath(mnemonicToXPrivArgs.path)
  return child.toBase58()
}

export function xprivToXPub(xprivToXPubArgs: XPrivToXPubArgs): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    xprivToXPubArgs.network,
    xprivToXPubArgs.coin,
    xprivToXPubArgs.type
  )
  const node: BIP32Interface = bip32.fromBase58(xprivToXPubArgs.xpriv, network)
  return node.neutered().toBase58()
}

// return pubkey hash / script hash based on chosen type and network
// this supports building
export function xpubToPubkey(xpubToPubkeyArgs: XPubToPubkeyArgs): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    xpubToPubkeyArgs.network,
    xpubToPubkeyArgs.coin,
    xpubToPubkeyArgs.type
  )
  const node: BIP32Interface = bip32.fromBase58(xpubToPubkeyArgs.xpub, network)
  const pubkey: Buffer = node
    .derive(xpubToPubkeyArgs.bip44ChangeIndex)
    .derive(xpubToPubkeyArgs.bip44AddressIndex).publicKey

  return pubkey.toString('hex')
}

export function addressToScriptPubkey(
  addressToScriptPubkeyArgs: AddressToScriptPubkeyArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    addressToScriptPubkeyArgs.network,
    addressToScriptPubkeyArgs.coin
  )
  const addressType: AddressTypeEnum = guessAddressTypeFromAddress(
    addressToScriptPubkeyArgs.address,
    network,
    addressToScriptPubkeyArgs.addressType
  )
  let payment: bitcoin.payments.PaymentCreator
  switch (addressType) {
    case AddressTypeEnum.p2pkh:
      payment = bitcoin.payments.p2pkh
      break
    case AddressTypeEnum.p2sh:
    case AddressTypeEnum.p2wpkhp2sh:
      payment = bitcoin.payments.p2sh
      break
    case AddressTypeEnum.p2wpkh:
      payment = bitcoin.payments.p2wpkh
      break
    case AddressTypeEnum.p2wsh:
      payment = bitcoin.payments.p2wsh
      break
    case AddressTypeEnum.cashaddrP2PKH:
      return scriptHashToScriptPubkey({
        scriptHash: cashAddressToHash(
          addressToScriptPubkeyArgs.address
        ).scriptHash.toString('hex'),
        network: addressToScriptPubkeyArgs.network,
        addressType: AddressTypeEnum.p2pkh,
        coin: addressToScriptPubkeyArgs.coin
      })
    case AddressTypeEnum.cashaddrP2SH:
      return scriptHashToScriptPubkey({
        scriptHash: cashAddressToHash(
          addressToScriptPubkeyArgs.address
        ).scriptHash.toString('hex'),
        network: addressToScriptPubkeyArgs.network,
        addressType: AddressTypeEnum.p2sh,
        coin: addressToScriptPubkeyArgs.coin
      })
    default:
      throw new Error('invalid address type in address to script pubkey')
  }
  const scriptPubkey = payment({
    address: addressToScriptPubkeyArgs.address,
    network: network
  }).output
  if (typeof scriptPubkey === 'undefined') {
    throw new Error('failed converting address to scriptPubkey')
  }
  return scriptPubkey.toString('hex')
}

export function scriptPubkeyToAddress(
  scriptPubkeyToAddressArgs: ScriptPubkeyToAddressArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    scriptPubkeyToAddressArgs.network,
    scriptPubkeyToAddressArgs.coin
  )
  let payment: bitcoin.payments.PaymentCreator
  switch (scriptPubkeyToAddressArgs.addressType) {
    case AddressTypeEnum.p2pkh:
      payment = bitcoin.payments.p2pkh
      break
    case AddressTypeEnum.p2sh:
    case AddressTypeEnum.p2wpkhp2sh:
      payment = bitcoin.payments.p2sh
      break
    case AddressTypeEnum.p2wpkh:
      payment = bitcoin.payments.p2wpkh
      break
    case AddressTypeEnum.p2wsh:
      payment = bitcoin.payments.p2wsh
      break
    case AddressTypeEnum.cashaddrP2PKH:
      if (scriptPubkeyToAddressArgs.network === NetworkEnum.Testnet) {
        return hashToCashAddress(
          scriptPubkeyToScriptHash({
            scriptPubkey: scriptPubkeyToAddressArgs.scriptPubkey,
            network: scriptPubkeyToAddressArgs.network,
            addressType: AddressTypeEnum.p2pkh,
            coin: scriptPubkeyToAddressArgs.coin
          }),
          cashaddrTypeEnum.pubkeyhash,
          cashaddrPrefixEnum.testnet
        )
      }
      return hashToCashAddress(
        scriptPubkeyToScriptHash({
          scriptPubkey: scriptPubkeyToAddressArgs.scriptPubkey,
          network: scriptPubkeyToAddressArgs.network,
          addressType: AddressTypeEnum.p2pkh,
          coin: scriptPubkeyToAddressArgs.coin
        }),
        cashaddrTypeEnum.pubkeyhash,
        cashaddrPrefixEnum.mainnet
      )
    case AddressTypeEnum.cashaddrP2SH:
      if (scriptPubkeyToAddressArgs.network === NetworkEnum.Testnet) {
        return hashToCashAddress(
          scriptPubkeyToScriptHash({
            scriptPubkey: scriptPubkeyToAddressArgs.scriptPubkey,
            network: scriptPubkeyToAddressArgs.network,
            addressType: AddressTypeEnum.p2sh,
            coin: scriptPubkeyToAddressArgs.coin
          }),
          cashaddrTypeEnum.scripthash,
          cashaddrPrefixEnum.testnet
        )
      }
      return hashToCashAddress(
        scriptPubkeyToScriptHash({
          scriptPubkey: scriptPubkeyToAddressArgs.scriptPubkey,
          network: scriptPubkeyToAddressArgs.network,
          addressType: AddressTypeEnum.p2sh,
          coin: scriptPubkeyToAddressArgs.coin
        }),
        cashaddrTypeEnum.scripthash,
        cashaddrPrefixEnum.mainnet
      )
    default:
      throw new Error('invalid address type in address to script pubkey')
  }
  const address: string | undefined = payment({
    output: Buffer.from(scriptPubkeyToAddressArgs.scriptPubkey, 'hex'),
    network: network
  }).address
  if (typeof address === 'undefined') {
    throw new Error('failed converting scriptPubkey to address')
  }
  return address
}

function scriptHashToScriptPubkey(
  scriptHashToScriptPubkeyArgs: ScriptHashToScriptPubkeyArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    scriptHashToScriptPubkeyArgs.network,
    scriptHashToScriptPubkeyArgs.coin
  )
  let payment: bitcoin.payments.PaymentCreator
  switch (scriptHashToScriptPubkeyArgs.addressType) {
    case AddressTypeEnum.p2pkh:
      payment = bitcoin.payments.p2pkh
      break
    case AddressTypeEnum.p2sh:
    case AddressTypeEnum.p2wpkhp2sh:
      payment = bitcoin.payments.p2sh
      break
    case AddressTypeEnum.p2wpkh:
      payment = bitcoin.payments.p2wpkh
      break
    case AddressTypeEnum.p2wsh:
      payment = bitcoin.payments.p2wsh
      break
    default:
      throw new Error('invalid address type in address to script pubkey')
  }
  const scriptPubkey: Buffer | undefined = payment({
    hash: Buffer.from(scriptHashToScriptPubkeyArgs.scriptHash, 'hex'),
    network: network
  }).output
  if (typeof scriptPubkey === 'undefined') {
    throw new Error('failed converting scriptPubkey to address')
  }
  return scriptPubkey.toString('hex')
}

export function scriptPubkeyToScriptHash(
  scriptPubkeytoScriptHashArgs: ScriptPubkeyToScriptHashArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    scriptPubkeytoScriptHashArgs.network,
    scriptPubkeytoScriptHashArgs.coin
  )
  let payment: bitcoin.payments.PaymentCreator
  switch (scriptPubkeytoScriptHashArgs.addressType) {
    case AddressTypeEnum.p2pkh:
    case AddressTypeEnum.cashaddrP2PKH:
      payment = bitcoin.payments.p2pkh
      break
    case AddressTypeEnum.p2sh:
    case AddressTypeEnum.cashaddrP2SH:
    case AddressTypeEnum.p2wpkhp2sh:
      payment = bitcoin.payments.p2sh
      break
    case AddressTypeEnum.p2wpkh:
      payment = bitcoin.payments.p2wpkh
      break
    case AddressTypeEnum.p2wsh:
      payment = bitcoin.payments.p2wsh
      break
    default:
      throw new Error('invalid address type in address to script pubkey')
  }
  const scriptHash: Buffer | undefined = payment({
    output: Buffer.from(scriptPubkeytoScriptHashArgs.scriptPubkey, 'hex'),
    network: network
  }).hash
  if (typeof scriptHash === 'undefined') {
    throw new Error('failed converting scriptPubkey to address')
  }
  return scriptHash.toString('hex')
}

export function pubkeyToScriptPubkey(
  pubkeyToScriptPubkeyArgs: PubkeyToScriptPubkeyArgs
): PubkeyToScriptPubkeyReturn {
  let payment: bitcoin.payments.Payment
  switch (pubkeyToScriptPubkeyArgs.addressType) {
    case AddressTypeEnum.p2pkh:
    case AddressTypeEnum.cashaddrP2PKH:
      payment = bitcoin.payments.p2pkh({
        pubkey: Buffer.from(pubkeyToScriptPubkeyArgs.pubkey, 'hex')
      })
      if (typeof payment.output === 'undefined') {
        throw new Error('failed converting pubkey to script pubkey')
      }
      return { scriptPubkey: payment.output.toString('hex') }
    case AddressTypeEnum.p2wpkhp2sh:
      payment = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({
          pubkey: Buffer.from(pubkeyToScriptPubkeyArgs.pubkey, 'hex')
        })
      })
      if (
        typeof payment.output === 'undefined' ||
        typeof payment.redeem === 'undefined' ||
        typeof payment.redeem.output === 'undefined'
      ) {
        throw new Error('failed converting pubkey to script pubkey')
      }
      return {
        scriptPubkey: payment.output.toString('hex'),
        redeemScript: payment.redeem.output.toString('hex')
      }
    case AddressTypeEnum.p2wpkh:
      payment = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(pubkeyToScriptPubkeyArgs.pubkey, 'hex')
      })
      if (typeof payment.output === 'undefined') {
        throw new Error('failed converting pubkey to script pubkey')
      }
      return { scriptPubkey: payment.output.toString('hex') }
    default:
      throw new Error('invalid address type in pubkey to script pubkey')
  }
}

export function xprivToPrivateKey(
  xprivToPrivateKeyArgs: XPrivToPrivateKeyArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    xprivToPrivateKeyArgs.network,
    xprivToPrivateKeyArgs.coin,
    xprivToPrivateKeyArgs.type
  )
  const node: BIP32Interface = bip32.fromBase58(
    xprivToPrivateKeyArgs.xpriv,
    network
  )
  const privateKey = node.derive(0).derive(0).privateKey
  if (typeof privateKey === 'undefined') {
    throw new Error('Failed to generate private key from xpriv')
  }
  return privateKey.toString('hex')
}

export function privateKeyToWIF(
  PrivateKeyToWIFArgs: PrivateKeyToWIFArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    PrivateKeyToWIFArgs.network,
    PrivateKeyToWIFArgs.coin
  )
  const ecPair: bitcoin.ECPairInterface = bitcoin.ECPair.fromPrivateKey(
    Buffer.from(PrivateKeyToWIFArgs.privateKey, 'hex'),
    { network }
  )
  return ecPair.toWIF()
}

export function wifToPrivateKey(
  wifToPrivateKeyArgs: WIFToPrivateKeyArgs
): string {
  const network: BitcoinJSNetwork = bip32NetworkFromCoin(
    wifToPrivateKeyArgs.network,
    wifToPrivateKeyArgs.coin
  )
  const privateKey = bitcoin.ECPair.fromWIF(wifToPrivateKeyArgs.wifKey, network)
    .privateKey
  if (typeof privateKey === 'undefined') {
    throw new Error('Failed to convert WIF key to private key')
  }
  return privateKey.toString('hex')
}

export function privateKeyToPubkey(privateKey: string): string {
  return bitcoin.ECPair.fromPrivateKey(
    Buffer.from(privateKey, 'hex')
  ).publicKey.toString('hex')
}

// Electrum uses the hash of the script pubkey to discover balances and transactions
export function scriptPubkeyToElectrumScriptHash(scriptPubkey: string): string {
  return Buffer.from(
    bitcoin.crypto.sha256(Buffer.from(scriptPubkey, 'hex')).reverse()
  ).toString('hex')
}

export function createTx(createTxArgs: CreateTxArgs): string {
  const psbt = new bitcoin.Psbt()
  let sequence: number = 0xffffffff
  if (createTxArgs.rbf) {
    sequence -= 2
  }
  for (let i: number = 0; i < createTxArgs.inputs.length; i++) {
    const input: TxInput = createTxArgs.inputs[i]
    if (input.type === TransactionInputTypeEnum.Legacy) {
      if (typeof input.prevTx === 'undefined') {
        throw Error(
          'legacy inputs require the full previous transaction to be passed'
        )
      }
      psbt.addInput({
        hash: input.prevTxid,
        index: input.index,
        sequence: sequence,
        // non-segwit inputs now require passing the whole previous tx as Buffer
        nonWitnessUtxo: Buffer.from(input.prevTx, 'hex')
      })
    } else {
      if (
        typeof input.prevScriptPubkey === 'undefined' ||
        typeof input.value === 'undefined'
      ) {
        throw Error(
          'segwit inputs require a script pubkey and value to be passed'
        )
      }

      if (typeof input.redeemScript === 'undefined') {
        psbt.addInput({
          hash: input.prevTxid,
          index: input.index,
          sequence: sequence,
          // add witnessUtxo for Segwit input type. The scriptPubkey and the value only are needed.
          witnessUtxo: {
            script: Buffer.from(input.prevScriptPubkey, 'hex'),
            value: input.value
          }
        })
        continue
      }

      psbt.addInput({
        hash: input.prevTxid,
        index: input.index,
        sequence: sequence,
        // add witnessUtxo for Segwit input type. The scriptPubkey and the value only are needed.
        witnessUtxo: {
          script: Buffer.from(input.prevScriptPubkey, 'hex'),
          value: input.value
        },
        redeemScript: Buffer.from(input.redeemScript, 'hex')
      })
    }
  }
  for (let i: number = 0; i < createTxArgs.outputs.length; i++) {
    psbt.addOutput({
      script: Buffer.from(createTxArgs.outputs[i].scriptPubkey, 'hex'),
      value: createTxArgs.outputs[i].amount
    })
  }
  return psbt.toBase64()
}

export function signTx(signTxArgs: SignTxArgs): string {
  const psbt = bitcoin.Psbt.fromBase64(signTxArgs.tx)
  for (let i: number = 0; i < signTxArgs.privateKeys.length; i++) {
    psbt.signInput(
      i,
      bitcoin.ECPair.fromPrivateKey(
        Buffer.from(signTxArgs.privateKeys[i], 'hex')
      )
    )
    psbt.validateSignaturesOfInput(i)
  }
  psbt.finalizeAllInputs()
  return psbt.extractTransaction().toHex()
}
