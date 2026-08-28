import { config, collection, singleton, fields } from '@keystatic/core';

export default config({
  storage: { kind: 'local' },
  ui: {
    brand: { name: 'Seek the Thrill' },
  },

  collections: {
    trips: collection({
      label: 'Trips',
      slugField: 'name',
      path: 'src/content/trips/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({ name: { label: 'Trip Name' } }),
        publicationStatus: fields.select({
          label: 'Publication Status',
          options: [
            { label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' },
            { label: 'Archived', value: 'archived' }, { label: 'Test only', value: 'test' },
          ],
          defaultValue: 'draft',
        }),
        priority: fields.select({
          label: 'Priority',
          options: [
            { label: 'High', value: 'high' },
            { label: 'Medium', value: 'medium' },
            { label: 'Low', value: 'low' },
          ],
          defaultValue: 'medium',
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Upcoming', value: 'upcoming' },
            { label: 'Booking Open', value: 'booking-open' },
            { label: 'Sold Out', value: 'sold-out' },
            { label: 'Completed', value: 'completed' },
          ],
          defaultValue: 'draft',
        }),
        featuredImage: fields.image({
          label: 'Featured Image',
          directory: 'public/images/trips',
          publicPath: '/images/trips/',
        }),
        shortDescription: fields.text({
          label: 'Short Description (for listing cards)',
          validation: { length: { max: 200 } },
        }),
        seoTitle: fields.text({ label: 'SEO Title', validation: { length: { max: 70 } } }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true, validation: { length: { max: 170 } } }),
        imageAlt: fields.text({ label: 'Featured Image Alt Text', validation: { length: { max: 180 } } }),
        startDate: fields.date({ label: 'Start Date' }),
        endDate: fields.date({ label: 'End Date' }),
        duration: fields.text({ label: 'Duration', description: 'e.g., "7 Days, 6 Nights"' }),
        pricePerPerson: fields.integer({ label: 'Price Per Person (₹)' }),
        minGroupSize: fields.integer({ label: 'Minimum Group Size' }),
        maxGroupSize: fields.integer({ label: 'Maximum Group Size' }),
        currentBookings: fields.integer({ label: 'Current Bookings', defaultValue: 0 }),
        description: fields.document({
          label: 'Trip Description',
          formatting: true,
          links: true,
        }),
        highlights: fields.array(
          fields.text({ label: 'Highlight' }),
          { label: 'Trip Highlights', itemLabel: (props) => props.value }
        ),
        whoShouldJoin: fields.document({
          label: 'Who Should Join',
          formatting: true,
        }),
        itinerary: fields.array(
          fields.object({
            dayNumber: fields.integer({ label: 'Day Number' }),
            dayTitle: fields.text({ label: 'Day Title' }),
            activities: fields.text({ label: 'Activities', multiline: true }),
            accommodation: fields.text({ label: 'Accommodation' }),
            breakfast: fields.checkbox({ label: 'Breakfast Included' }),
            lunch: fields.checkbox({ label: 'Lunch Included' }),
            dinner: fields.checkbox({ label: 'Dinner Included' }),
            mealsNotes: fields.text({ label: 'Meals Notes (optional)' }),
            transport: fields.text({ label: 'Transport Details (optional)' }),
            specialNotes: fields.text({ label: 'Special Notes (optional)' }),
          }),
          {
            label: 'Day-by-Day Itinerary',
            itemLabel: (props) => `Day ${props.fields.dayNumber.value}: ${props.fields.dayTitle.value}`,
          }
        ),
        included: fields.array(
          fields.text({ label: 'Item' }),
          { label: "What's Included", itemLabel: (props) => props.value }
        ),
        notIncluded: fields.array(
          fields.text({ label: 'Item' }),
          { label: "What's Not Included", itemLabel: (props) => props.value }
        ),
        meetingPoint: fields.text({ label: 'Meeting Point Details', multiline: true }),
        meetingTime: fields.text({ label: 'Meeting Time' }),
        packingList: fields.array(
          fields.text({ label: 'Item' }),
          { label: 'Packing List', itemLabel: (props) => props.value }
        ),
        importantNotes: fields.text({ label: 'Important Notes', multiline: true }),
        cancellationPolicy: fields.text({ label: 'Cancellation Policy (leave empty for site default)', multiline: true }),
        paymentQrCode: fields.image({
          label: 'Payment QR Code',
          directory: 'public/images/qr',
          publicPath: '/images/qr/',
        }),
        paymentAmount: fields.integer({ label: 'Advance / Booking Amount (₹) — paid now to confirm spot (defaults to trip price if empty)' }),
        fullPaymentAmount: fields.integer({ label: 'Full Trip Payment Amount (₹) — due 15 days before trip (defaults to trip price if empty)' }),
        paymentInstructions: fields.text({ label: 'Payment Instructions (leave empty for default)', multiline: true }),
        gallery: fields.array(
          fields.object({
            image: fields.image({
              label: 'Photo',
              directory: 'public/images/trips/gallery',
              publicPath: '/images/trips/gallery/',
            }),
            caption: fields.text({ label: 'Caption (optional)' }),
          }),
          { label: 'Trip Gallery' }
        ),
        registrationDeadline: fields.date({ label: 'Registration Deadline' }),
      },
    }),

    albums: collection({
      label: 'Photo Albums',
      slugField: 'name',
      path: 'src/content/albums/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({ name: { label: 'Album Name (Trip Name)' } }),
        publicationStatus: fields.select({
          label: 'Publication Status',
          options: [
            { label: 'Draft', value: 'draft' }, { label: 'Published', value: 'published' },
            { label: 'Archived', value: 'archived' }, { label: 'Test only', value: 'test' },
          ],
          defaultValue: 'draft',
        }),
        location: fields.text({ label: 'Location' }),
        date: fields.date({ label: 'Trip Date' }),
        description: fields.text({ label: 'Description (optional)' }),
        seoTitle: fields.text({ label: 'SEO Title', validation: { length: { max: 70 } } }),
        seoDescription: fields.text({ label: 'SEO Description', multiline: true, validation: { length: { max: 170 } } }),
        socialImageAlt: fields.text({ label: 'Social Image Alt Text', validation: { length: { max: 180 } } }),
        coverImage: fields.image({
          label: 'Cover Image',
          directory: 'public/images/albums',
          publicPath: '/images/albums/',
        }),
        photos: fields.array(
          fields.object({
            image: fields.image({
              label: 'Photo',
              directory: 'public/images/albums/photos',
              publicPath: '/images/albums/photos/',
            }),
            caption: fields.text({ label: 'Caption (optional)' }),
          }),
          { label: 'Photos' }
        ),
      },
    }),

    testimonials: collection({
      label: 'Testimonials',
      slugField: 'name',
      path: 'src/content/testimonials/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({ name: { label: 'Traveler Name' } }),
        location: fields.text({ label: 'Location (City, Country)' }),
        rating: fields.integer({ label: 'Rating (1-5)', defaultValue: 5 }),
        tripName: fields.text({
          label: 'Trip taken',
          description: 'Optional display context only. This does not control where the testimonial appears.',
        }),
        quote: fields.text({ label: 'Testimonial Quote', multiline: true }),
        photo: fields.image({
          label: 'Traveler Photo',
          directory: 'public/images/testimonials',
          publicPath: '/images/testimonials/',
        }),
        featured: fields.checkbox({ label: 'Show on Homepage', defaultValue: true }),
      },
    }),
  },

  singletons: {
    siteSettings: singleton({
      label: 'Site Settings',
      path: 'src/content/site-settings',
      format: { data: 'yaml' },
      schema: {
        email: fields.text({ label: 'Contact Email', defaultValue: 'zahra@seekthethrill.in' }),
        phone: fields.text({ label: 'Phone Number', defaultValue: '+91-7975027491' }),
        whatsappLink: fields.url({ label: 'WhatsApp Link' }),
        address: fields.text({ label: 'Office Address', multiline: true }),
        instagram: fields.url({ label: 'Instagram URL' }),
        facebook: fields.url({ label: 'Facebook URL' }),
        youtube: fields.url({ label: 'YouTube URL' }),
        linkedin: fields.url({ label: 'LinkedIn URL' }),
        tripsCompleted: fields.integer({ label: 'Trips Completed', defaultValue: 25 }),
        happyTravelers: fields.integer({ label: 'Happy Travelers', defaultValue: 500 }),
        destinationsCovered: fields.integer({ label: 'Destinations Covered', defaultValue: 15 }),
        yearsOfAdventure: fields.integer({ label: 'Years of Adventure', defaultValue: 4 }),
        cancellationPolicy: fields.text({ label: 'Default Cancellation Policy', multiline: true }),
        termsAndConditions: fields.text({ label: 'Terms & Conditions', multiline: true }),
        privacyPolicy: fields.text({ label: 'Privacy Policy', multiline: true }),
        defaultQrCode: fields.image({
          label: 'Default Payment QR Code',
          directory: 'public/images/qr',
          publicPath: '/images/qr/',
        }),
        defaultPaymentInstructions: fields.text({ label: 'Default Payment Instructions', multiline: true }),
        bankDetails: fields.text({ label: 'Bank Details', multiline: true }),
        googleAnalyticsId: fields.text({ label: 'Google Analytics ID' }),
        copyrightText: fields.text({
          label: 'Copyright Text',
          defaultValue: '© 2024 Seek the Thrill. All rights reserved.',
        }),
      },
    }),
  },
});
