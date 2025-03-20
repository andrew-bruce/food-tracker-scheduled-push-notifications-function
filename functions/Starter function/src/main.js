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



  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split("T")[0];

    // get household ids containing expiring items
    const itemResponse = await databases.listDocuments(
      process.env.DATABASE,
      process.env.ITEM_COLLECTION,
      [Query.equal("expiry", tomorrowISO), Query.select(["name", "householdId", "expiry"])]
    )

    // remove duplicates
    const uniqueItems = [...new Set(itemResponse.documents)];

    for (let i = 0; i < uniqueItems.length; i++) {
      // get the users for each household
      const household = await databases.getDocument(
        process.env.DATABASE,
        process.env.HOUSEHOLD_COLLECTION,
        uniqueItems[i].householdId,
        [Query.select(["users"])]
      )

      // get the push notification target of each user
      for (let j = 0; i < household.users.length; j++) {
        if (!household.users[j]) {
          break;
        }
        let targets = await users.listTargets(
          household.users[j],
          [Query.equal("providerType", "push")]
        )

        // add the targets to the item
        uniqueItems[i]["targets"] = [...new Set(targets.targets.map(target => target.$id))];
      }

      // break if no targets
      if (!uniqueItems[i].targets || uniqueItems[i].targets.length == 0) break;

      const date = new Date(uniqueItems[i].expiry);

      const formattedDate = date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });

      // send push notification to each target with relevant information about the item
      const result = await messaging.createPush(
        ID.unique(), // messageId
        `Your food is expiring soon!`, // title
        `${uniqueItems[i].name} is expiring on ${formattedDate}`, // body
        [],
        [],
        uniqueItems[i].targets, // targets
      );
    }


  } catch (err) {
    error("Could not list users: " + err.message);
  }

  return res.json({
    motto: "Build like a team of hundreds_",
    learn: "https://appwrite.io/docs",
    connect: "https://appwrite.io/discord",
    getInspired: "https://builtwith.appwrite.io",
  });
};
