# Scaling Strategy for ConnectVerse

This document outlines the scaling strategy for the ConnectVerse application, which is built on Next.js and Firebase. The architecture is designed to be highly scalable with minimal manual intervention.

## Frontend: Next.js on Firebase App Hosting

The Next.js application is deployed on Firebase App Hosting, a managed, serverless platform.

- **Horizontal Scaling**: App Hosting automatically handles horizontal scaling. When traffic increases, it provisions more backend instances to handle the load. You can configure the `maxInstances` in `apphosting.yaml` to control the upper limit. This provides an elastic infrastructure that scales with user demand.
- **Global CDN**: Static assets (JavaScript, CSS, images) are automatically cached on Firebase's global CDN. This ensures fast load times for users anywhere in the world by serving content from a location geographically close to them.
- **Serverless Functions**: Next.js API routes and Server-Side Rendering (SSR) are executed as on-demand serverless functions. This model is inherently scalable, as new function instances are spun up to handle concurrent requests.

## Backend: Firebase Services

The application leverages several managed Firebase services that are built for massive scale.

- **Firestore**: As a serverless, NoSQL database, Firestore scales automatically to meet your data storage and traffic needs. You do not need to provision servers or manage sharding. Its performance scales with the size of your result set, not the size of your data set, making queries fast even with billions of documents.
- **Firebase Authentication**: This service is a multi-tenant, managed system that handles user authentication at a global scale. It automatically handles the infrastructure required to sign in millions of users without any scaling effort on your part.

## WebRTC Architecture: P2P vs SFU

ConnectVerse currently uses a **Full Mesh P2P** (Peer-to-Peer) architecture. 

### Current P2P Mesh
- **Strengths**: Low latency, zero server bandwidth costs, end-to-end encryption by default.
- **Limits**: As the number of participants grows (N), each participant must maintain N-1 connections. This leads to exponential growth in CPU and upload bandwidth requirements on the client side.
- **Optimization**: We have implemented `contentHint` for screen sharing and quality constraints for video to mitigate bandwidth issues.

### Future Scaling (SFU)
For meetings exceeding 10-15 participants, we recommend transitioning to an **SFU (Selective Forwarding Unit)** like LiveKit or Mediasoup.
- An SFU acts as a hub where each participant sends only 1 stream and receives N-1 streams, significantly reducing client-side upload requirements.

## TURN Server Scaling

For production WebRTC, a TURN server is required to relay traffic for users behind restrictive firewalls.
- **Managed Services**: Use a managed TURN server provider like Twilio's Network Traversal Service or Xirsys. These services handle the scaling and geographic distribution of TURN servers for you.
- **Self-Hosted**: If self-hosting, you would need a load balancer distributing traffic across multiple `coturn` instances in different regions to ensure high availability and low latency.

## Quota & Rate Limiting
- We have implemented aggressive client-side batching and throttling (25s ICE candidate buffering, 20s presence sync) to ensure the application remains stable and cost-effective under high load within the Firestore limits.
