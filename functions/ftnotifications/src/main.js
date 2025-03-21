import { Client, Users, Databases, Query, Messaging, ID } from 'node-appwrite';

// This Appwrite function will be executed every time your function is triggered
export default async ({ req, res, log, error }) => {
  // You can use the Appwrite SDK to interact with other services
  // For this example, we're using the Users service
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] ?? '');
  const databases = new Databases(client);
  const users = new Users(client);
  const messaging = new Messaging(client);
  let notifications = []
  let households = []

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split("T")[0];

    log('Fetching items..')
    // get household ids containing expiring items
    const itemResponse = await databases.listDocuments(
      process.env.DATABASE,
      process.env.ITEM_COLLECTION,
      [Query.equal("expiry", tomorrowISO), Query.select(["name", "householdId", "expiry"])]
    )

    log(`Fetched ${itemResponse.documents.length} items`);

    // remove duplicates
    const uniqueItems = [...new Set(itemResponse.documents)];

    log('Looping through items...');
    for (let i = 0; i < uniqueItems.length; i++) {
      const householdIdForItem = uniqueItems[i].householdId;
      // if array doesn't contain household already then we need to
      // get it's users and targets
      if (!households.some(h => h.id === householdIdForItem)) {
        // get the users for each household
        log(`Getting users for household ${householdIdForItem}...`);
        const household = await databases.getDocument(
          process.env.DATABASE,
          process.env.HOUSEHOLD_COLLECTION,
          householdIdForItem,
          [Query.select(["users"])]
        )
        log(`Found ${household.users.length} user in household ${householdIdForItem}`);

        // get the push notification target of each user
        log('Finding push targets for users...')
        for (let j = 0; i < household.users.length; j++) {
          if (!household.users[j]) {
            break;
          }
          let targets = await users.listTargets(
            household.users[j],
            [Query.equal("providerType", "push")]
          )

          log(`Found ${targets.targets.length} targets for user ${household.users[j]}`);

          // add the targets to the item
          let targetIds = [...new Set(targets.targets.map(target => target.$id))];
          let newHouse = {id: householdIdForItem, targets: targetIds}

          log('Saving household targets to array for rest of function execution...');
          households.push(newHouse);
        }
      }
      else {
        log(`Already fetched targets for household ${householdIdForItem}`);
      }

      let householdFromArray = households.find(h => h.id === householdIdForItem);

      // break if no targets
      if (!householdFromArray.targets || householdFromArray.targets.length == 0) {
        log(`No targets found for household ${householdFromArray.id} - ${uniqueItems[i].name}`);
        break;
      }

      log('Formatting date');
      const date = new Date(uniqueItems[i].expiry);

      const formattedDate = date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });

      // build array of notifications
      householdFromArray.targets.forEach(target => {
        if (!notifications.some(n => n.target === target)) {
          notifications.push({target: target, items: [uniqueItems[i].name]});
        }
        else {
          let notification = notifications.find(n => n.target === target);
          notification.items.push(uniqueItems[i].name);
        }
      });
    }

    for(let i=0; i<notifications.length; i++) {
      let message = "";
      if (notifications[i].items.length === 1) {
        message = `${notifications[i].items[0]} is expiring tomorrow!`;
      }
      else if (notifications[i].items.length === 2) {
        message = `${notifications[i].items[0]} and one other item is expiring tomorrow!`;
      }
      else if (notifications[i].items.length > 2) {
        message = `${notifications[i].items[0]} and ${notifications[i].items.length-1} other items are expiring tomorrow!`;
      }

      log(`Sending push notification to ${notifications[i].target} for ${notifications[i].items.length} items`);
      // send push notification to each target with relevant information about the item
      await messaging.createPush(
        ID.unique(), // messageId
        `Food Tracker`, // title
        `${message}`, // body
        [],
        [],
        [notifications[i].target], // targets
      );
    }


  } catch (err) {
    error("Could not list users: " + err.message);
  }

  return res.json(JSON.stringify(notifications));
};
