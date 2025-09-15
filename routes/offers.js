// backend/routes/offers.js

const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Product = require('../models/Product'); // Adjust to your model name
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const auth = require('../middleware/auth'); // Your auth middleware

// CREATE NEW OFFER
// POST /api/offers
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, offerAmount, message } = req.body;
    const buyerId = req.user.id;

    // Validate listing exists and is available
    const listing = await Product.findById(listingId).populate('seller');
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listing.status !== 'available') {
      return res.status(400).json({ error: 'Listing is no longer available' });
    }

    if (!listing.acceptsOffers) {
      return res.status(400).json({ error: 'This listing does not accept offers' });
    }

    // Prevent self-offers
    if (listing.seller._id.toString() === buyerId) {
      return res.status(400).json({ error: 'You cannot make an offer on your own listing' });
    }

    // Check for existing pending offer from this buyer
    const existingOffer = await Offer.findOne({
      listing: listingId,
      buyer: buyerId,
      status: 'pending'
    });

    if (existingOffer) {
      // Check if 24 hours have passed since last offer
      const hoursSinceOffer = (Date.now() - existingOffer.createdAt) / (1000 * 60 * 60);
      if (hoursSinceOffer < 24) {
        return res.status(400).json({ 
          error: `Please wait ${Math.ceil(24 - hoursSinceOffer)} more hours before making another offer` 
        });
      }
      // Expire the old offer
      existingOffer.status = 'withdrawn';
      await existingOffer.save();
    }

    // Create the offer
    const offer = new Offer({
      listing: listingId,
      buyer: buyerId,
      seller: listing.seller._id,
      offerAmount,
      originalPrice: listing.price,
      message,
      autoAcceptPrice: listing.autoAcceptPrice,
      minimumOffer: listing.minimumOffer
    });

    // Check for auto-response
    const autoResponse = offer.checkAutoResponse();
    
    if (autoResponse === 'accept') {
      offer.status = 'accepted';
      offer.acceptedAt = new Date();
      
      // Update listing status
      listing.status = 'sold';
      listing.soldTo = buyerId;
      listing.soldPrice = offerAmount;
      await listing.save();
      
      // Send auto-accept message
      const conversation = await Conversation.findOrCreate(
        [buyerId, listing.seller._id],
        listingId
      );
      
      await Message.create({
        conversation: conversation._id,
        sender: listing.seller._id,
        receiver: buyerId,
        listing: listingId,
        message: `Great news! Your offer of $${offerAmount} has been automatically accepted. Please proceed with payment.`,
        isOffer: true,
        offerDetails: {
          offerId: offer._id,
          amount: offerAmount,
          action: 'accepted'
        }
      });
      
    } else if (autoResponse === 'decline') {
      offer.status = 'declined';
      offer.declinedAt = new Date();
      
      // Send auto-decline message
      const conversation = await Conversation.findOrCreate(
        [buyerId, listing.seller._id],
        listingId
      );
      
      await Message.create({
        conversation: conversation._id,
        sender: listing.seller._id,
        receiver: buyerId,
        listing: listingId,
        message: `Your offer of $${offerAmount} is below the minimum acceptable price for this item.`,
        isOffer: true,
        offerDetails: {
          offerId: offer._id,
          amount: offerAmount,
          action: 'declined'
        }
      });
    } else {
      // Send offer notification message
      const conversation = await Conversation.findOrCreate(
        [buyerId, listing.seller._id],
        listingId
      );
      
      await Message.create({
        conversation: conversation._id,
        sender: buyerId,
        receiver: listing.seller._id,
        listing: listingId,
        message: message || `Offer of $${offerAmount} for ${listing.title}`,
        isOffer: true,
        offerDetails: {
          offerId: offer._id,
          amount: offerAmount,
          action: 'created'
        }
      });
    }

    await offer.save();
    await offer.populate('buyer seller listing');

    res.status(201).json({
      success: true,
      offer,
      autoResponse
    });

  } catch (error) {
    console.error('Create offer error:', error);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// GET RECEIVED OFFERS (for sellers)
// GET /api/offers/received
router.get('/received', auth, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { status, listingId } = req.query;

    const query = { seller: sellerId };
    if (status) query.status = status;
    if (listingId) query.listing = listingId;

    const offers = await Offer.find(query)
      .populate('buyer', 'username email rating reviewCount')
      .populate('listing', 'title price images')
      .sort({ createdAt: -1 });

    // Check for expired offers and update their status
    for (const offer of offers) {
      if (offer.isExpired()) {
        offer.status = 'expired';
        await offer.save();
      }
    }

    res.json({
      success: true,
      offers,
      stats: {
        pending: offers.filter(o => o.status === 'pending').length,
        accepted: offers.filter(o => o.status === 'accepted').length,
        declined: offers.filter(o => o.status === 'declined').length,
        expired: offers.filter(o => o.status === 'expired').length
      }
    });

  } catch (error) {
    console.error('Get received offers error:', error);
    res.status(500).json({ error: 'Failed to get offers' });
  }
});

// GET SENT OFFERS (for buyers)
// GET /api/offers/sent
router.get('/sent', auth, async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { status } = req.query;

    const query = { buyer: buyerId };
    if (status) query.status = status;

    const offers = await Offer.find(query)
      .populate('seller', 'username email')
      .populate('listing', 'title price images status')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      offers
    });

  } catch (error) {
    console.error('Get sent offers error:', error);
    res.status(500).json({ error: 'Failed to get offers' });
  }
});

// ACCEPT OFFER
// PUT /api/offers/:id/accept
router.put('/:id/accept', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id)
      .populate('listing')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify seller
    if (offer.seller.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({ error: 'Offer is no longer pending' });
    }

    if (offer.isExpired()) {
      offer.status = 'expired';
      await offer.save();
      return res.status(400).json({ error: 'Offer has expired' });
    }

    // Accept the offer
    offer.status = 'accepted';
    offer.acceptedAt = new Date();
    await offer.save();

    // Update listing
    const listing = offer.listing;
    listing.status = 'sold';
    listing.soldTo = offer.buyer._id;
    listing.soldPrice = offer.offerAmount;
    listing.soldAt = new Date();
    await listing.save();

    // Decline all other pending offers for this listing
    await Offer.updateMany(
      {
        listing: listing._id,
        status: 'pending',
        _id: { $ne: offer._id }
      },
      {
        status: 'declined',
        declinedAt: new Date()
      }
    );

    // Send acceptance message
    const conversation = await Conversation.findOrCreate(
      [offer.buyer._id, offer.seller],
      listing._id
    );

    await Message.create({
      conversation: conversation._id,
      sender: offer.seller,
      receiver: offer.buyer._id,
      listing: listing._id,
      message: `Congratulations! Your offer of $${offer.offerAmount} has been accepted. Please proceed with payment to complete the purchase.`,
      isOffer: true,
      offerDetails: {
        offerId: offer._id,
        amount: offer.offerAmount,
        action: 'accepted'
      }
    });

    res.json({
      success: true,
      offer,
      message: 'Offer accepted successfully'
    });

  } catch (error) {
    console.error('Accept offer error:', error);
    res.status(500).json({ error: 'Failed to accept offer' });
  }
});

// DECLINE OFFER
// PUT /api/offers/:id/decline
router.put('/:id/decline', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const offer = await Offer.findById(req.params.id)
      .populate('listing')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify seller
    if (offer.seller.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({ error: 'Offer is no longer pending' });
    }

    // Decline the offer
    offer.status = 'declined';
    offer.declinedAt = new Date();
    await offer.save();

    // Send decline message
    const conversation = await Conversation.findOrCreate(
      [offer.buyer._id, offer.seller],
      offer.listing._id
    );

    await Message.create({
      conversation: conversation._id,
      sender: offer.seller,
      receiver: offer.buyer._id,
      listing: offer.listing._id,
      message: reason || `Your offer of $${offer.offerAmount} has been declined.`,
      isOffer: true,
      offerDetails: {
        offerId: offer._id,
        amount: offer.offerAmount,
        action: 'declined'
      }
    });

    res.json({
      success: true,
      offer,
      message: 'Offer declined'
    });

  } catch (error) {
    console.error('Decline offer error:', error);
    res.status(500).json({ error: 'Failed to decline offer' });
  }
});

// COUNTER OFFER
// PUT /api/offers/:id/counter
router.put('/:id/counter', auth, async (req, res) => {
  try {
    const { counterAmount, counterMessage } = req.body;
    const offer = await Offer.findById(req.params.id)
      .populate('listing')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify seller
    if (offer.seller.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({ error: 'Offer is no longer pending' });
    }

    // Validate counter amount
    if (counterAmount <= offer.offerAmount) {
      return res.status(400).json({ 
        error: 'Counter offer must be higher than the original offer' 
      });
    }

    if (counterAmount > offer.originalPrice) {
      return res.status(400).json({ 
        error: 'Counter offer cannot exceed the listing price' 
      });
    }

    // Update offer with counter
    offer.status = 'countered';
    offer.counterOffer = {
      amount: counterAmount,
      message: counterMessage,
      timestamp: new Date()
    };
    offer.expiresAt = new Date(+new Date() + 48*60*60*1000); // Reset expiration
    await offer.save();

    // Send counter offer message
    const conversation = await Conversation.findOrCreate(
      [offer.buyer._id, offer.seller],
      offer.listing._id
    );

    await Message.create({
      conversation: conversation._id,
      sender: offer.seller,
      receiver: offer.buyer._id,
      listing: offer.listing._id,
      message: `Counter offer: $${counterAmount}. ${counterMessage || ''}`,
      isOffer: true,
      offerDetails: {
        offerId: offer._id,
        amount: counterAmount,
        action: 'countered'
      }
    });

    res.json({
      success: true,
      offer,
      message: 'Counter offer sent'
    });

  } catch (error) {
    console.error('Counter offer error:', error);
    res.status(500).json({ error: 'Failed to counter offer' });
  }
});

// WITHDRAW OFFER (for buyers)
// PUT /api/offers/:id/withdraw
router.put('/:id/withdraw', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify buyer
    if (offer.buyer.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (offer.status !== 'pending' && offer.status !== 'countered') {
      return res.status(400).json({ error: 'Offer cannot be withdrawn' });
    }

    offer.status = 'withdrawn';
    await offer.save();

    res.json({
      success: true,
      offer,
      message: 'Offer withdrawn'
    });

  } catch (error) {
    console.error('Withdraw offer error:', error);
    res.status(500).json({ error: 'Failed to withdraw offer' });
  }
});

// RESPOND TO COUNTER OFFER (for buyers)
// PUT /api/offers/:id/respond-counter
router.put('/:id/respond-counter', auth, async (req, res) => {
  try {
    const { accept } = req.body; // true to accept, false to decline
    const offer = await Offer.findById(req.params.id)
      .populate('listing')
      .populate('seller');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify buyer
    if (offer.buyer.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (offer.status !== 'countered') {
      return res.status(400).json({ error: 'No counter offer to respond to' });
    }

    if (accept) {
      // Accept counter offer
      offer.status = 'accepted';
      offer.acceptedAt = new Date();
      offer.offerAmount = offer.counterOffer.amount; // Update to counter amount
      await offer.save();

      // Update listing
      const listing = offer.listing;
      listing.status = 'sold';
      listing.soldTo = offer.buyer;
      listing.soldPrice = offer.counterOffer.amount;
      listing.soldAt = new Date();
      await listing.save();

      // Send acceptance message
      const conversation = await Conversation.findOrCreate(
        [offer.buyer, offer.seller._id],
        listing._id
      );

      await Message.create({
        conversation: conversation._id,
        sender: offer.buyer,
        receiver: offer.seller._id,
        listing: listing._id,
        message: `Counter offer of $${offer.counterOffer.amount} accepted! Ready to proceed with payment.`,
        isOffer: true,
        offerDetails: {
          offerId: offer._id,
          amount: offer.counterOffer.amount,
          action: 'accepted'
        }
      });
    } else {
      // Decline counter offer
      offer.status = 'declined';
      offer.declinedAt = new Date();
      await offer.save();
    }

    res.json({
      success: true,
      offer,
      message: accept ? 'Counter offer accepted' : 'Counter offer declined'
    });

  } catch (error) {
    console.error('Respond to counter error:', error);
    res.status(500).json({ error: 'Failed to respond to counter offer' });
  }
});

// GET OFFER STATISTICS
// GET /api/offers/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [sellerStats, buyerStats] = await Promise.all([
      Offer.aggregate([
        { $match: { seller: mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$offerAmount' },
            avgOffer: { $avg: '$offerAmount' },
            avgPercentage: { 
              $avg: { 
                $multiply: [
                  { $divide: ['$offerAmount', '$originalPrice'] }, 
                  100
                ] 
              } 
            }
          }
        }
      ]),
      Offer.aggregate([
        { $match: { buyer: mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$offerAmount' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      asSeller: sellerStats,
      asBuyer: buyerStats
    });

  } catch (error) {
    console.error('Get offer stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;