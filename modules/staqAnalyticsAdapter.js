import adapter from '../src/AnalyticsAdapter';
import CONSTANTS from '../src/constants.json';
import adapterManager from '../src/adapterManager';
import { logInfo } from '../src/utils';
import find from 'core-js/library/fn/array/find';
import findIndex from 'core-js/library/fn/array/find-index';

const events = CONSTANTS.EVENTS;

let staqAdapter = Object.assign(adapter({}),
  {
    track({ eventType, args }) {
      switch (eventType) {
        case events.AUCTION_INIT:
          staqAdapter.initAuction();
          staqAdapter.auction.id = args.auctionId;
          break;
        case events.BID_TIMEOUT:
          staqAdapter.auction.timedOut = true;
          break;
        case events.BID_RESPONSE:
          staqAdapter.bucketEvents.push({
            type: 'response',
            event: staqAdapter.buildResponse(args)
          })
          break;
        case events.BID_WON:
          staqAdapter.sendWonEvent({
            id: args.adId,
            placementCode: args.adUnitCode
          });
          break;
        case events.BID_REQUESTED:
          args.bids.forEach(function(bid) {
            staqAdapter.bucketEvents.push({
              type: 'request',
              event: {
                bidder: bid.bidder.toUpperCase(),
                placementCode: bid.placementCode
              }
            });
          });
          break;
        case events.AUCTION_END:
          if (staqAdapter.bucketEvents.length > 0) {
            staqAdapter.setTypedEvent();
          }
          break;
      }
    }
  }
);

staqAdapter.initAuction = function() {
  staqAdapter.bucketEvents = []
}

staqAdapter.buildResponse = function (bidArgs) {
  return {
    bidder: bidArgs.bidderCode.toUpperCase(),
    placementCode: bidArgs.adUnitCode,
    id: bidArgs.adId,
    status: (bidArgs.statusMessage === 'Bid available') ? 'VALID' : 'EMPTY_OR_ERROR',
    cpm: parseFloat(bidArgs.cpm),
    size: {
      width: Number(bidArgs.width),
      height: Number(bidArgs.height)
    },
    timeToRespond: bidArgs.timeToRespond,
    afterTimeout: staqAdapter.auction.timedOut
  }
}

staqAdapter.sendWonEvent = function (wonEvent) {
  const stringWonEvent = JSON.stringify(wonEvent);
  logInfo('Won event sent to STAQ' + wonEvent);

  const encodedBuf = window.btoa(stringWonEvent);
  const encodedUri = encodeURIComponent(encodedBuf);
  const img = new Image(1, 1);
  img.src = `https://${staqAdapter.auction.url}/?q=${encodedUri}&id=${staqAdapter.auction.id}&won=true`
}

staqAdapter.adapterEnableAnalytics = staqAdapter.enableAnalytics;

staqAdapter.enableAnalytics = function (config) {
  staqAdapter.auction = {};

  const options = config.options;
  if (options) {
    staqAdapter.auction = {
      uid: options.id,
      url: options.url,
      id: '',
      timedOut: false,
    }
    logInfo('STAQ Analytics enabled with config', options);
    staqAdapter.adapterEnableAnalytics(config)
  }
}

staqAdapter.sendTypedEvent = function() {
  const groupedTypedEvents = adomik.buildTypedEvents();

  const bulkEvents = {
    uid: staqAdapter.currentContext.uid,
    ahbaid: staqAdapter.currentContext.id,
    hostname: window.location.hostname,
    eventsByPlacementCode: groupedTypedEvents.map(function(typedEventsByType) {
      let sizes = [];
      const eventKeys = ['request', 'response', 'winner'];
      let events = {};

      eventKeys.forEach((eventKey) => {
        events[`${eventKey}s`] = [];
        if (typedEventsByType[eventKey] !== undefined) {
          typedEventsByType[eventKey].forEach((typedEvent) => {
            if (typedEvent.event.size !== undefined) {
              const size = staqAdapter.sizeUtils.handleSize(sizes, typedEvent.event.size);
              if (size !== null) {
                sizes = [...sizes, size];
              }
            }
            events[`${eventKey}s`] = [...events[`${eventKey}s`], typedEvent.event];
          });
        }
      });

      return {
        placementCode: typedEventsByType.placementCode,
        sizes,
        events
      };
    })
  };

  const stringBulkEvents = JSON.stringify(bulkEvents)
  logInfo('Events sent to adomik prebid analytic ' + stringBulkEvents);

  // Encode object in base64
  const encodedBuf = window.btoa(stringBulkEvents);

  // Create final url and split it in 1600 characters max (+endpoint length)
  const encodedUri = encodeURIComponent(encodedBuf);
  const splittedUrl = encodedUri.match(/.{1,1600}/g);

  splittedUrl.forEach((split, i) => {
    const partUrl = `${split}&id=${adomikAdapter.currentContext.id}&part=${i}&on=${splittedUrl.length - 1}`;
    const img = new Image(1, 1);
    img.src = 'https://' + adomikAdapter.currentContext.url + '/?q=' + partUrl;
  })
}

staqAdapter.buildTypedEvents = function () {
  const groupedTypedEvents = [];

  staqAdapter.bucketEvents.forEach(function(typedEvent, i) {
    const [placementCode, type] = [typedEvent.event.placementCode, typedEvent.type];
    let existTypedEvent = findIndex(groupedTypedEvents, (groupTypedEvent) => groupTypedEvent.placementCode === placementCode);

    if (existTypedEvent === -1) {
      groupedTypedEvents.push({
        placementCode: placementCode,
        [type]: [typedEvent]
      });
      existTypedEvent = groupedTypedEvents.length - 1;
    }

    if (groupTypedEvents[existTypedEvent][type]) {
      groupedTypedEvents[existTypedEvent][type] = [...groupedTypedEvents[existTypedEvent][type], typedEvent];
    } else {
      groupedTypedEvents[existTypedEvent][type] = [typedEvent];
    }
  });

  return groupTypedEvents;
}

adapterManager.registerAnalyticsAdapter({
  adapter: staqAdapter,
  code: 'staq'
});

export default staqAdapter;
