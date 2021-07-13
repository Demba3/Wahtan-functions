const { db, admin } = require("../util/admin");

const { firebaseConfig } = require("../util/config");

const firebase = require("firebase");
firebase.initializeApp(firebaseConfig);

const {
  validateLoginData,
  validateSignupData,
  reduceUserDetails,
} = require("../util/validators");

exports.signUp = (req, res) => {
  const newUser = {
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
    handle: req.body.handle,
  };
  //validate data
  const { valid, errors } = validateSignupData(newUser);
  if (!valid) return res.status(400).json(errors);

  const blankImg = "no-img.png";
  let token;
  let userId;
  db.doc(`/users/${newUser.handle}`)
    .get()
    .then((doc) => {
      if (doc.exists) {
        return res.status(400).json({ handle: "This handle is already taken" });
      } else {
        return firebase
          .auth()
          .createUserWithEmailAndPassword(newUser.email, newUser.password);
      }
    })
    .then((data) => {
      userId = data.user.uid;
      return data.user.getIdToken();
    })
    .then((idtoken) => {
      token = idtoken;
      const userCredentials = {
        userId,
        createdAt: new Date().toISOString(),
        email: newUser.email,
        imageUrl: `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${blankImg}?alt=media`,
        handle: newUser.handle,
      };
      return db
        .collection("users")
        .doc(`${userCredentials.handle}`)
        .set(userCredentials);
    })
    .then(() => {
      return res.status(201).json({ token });
    })
    .catch((err) => {
      if (err.code === "auth/email-already-in-use") {
        return res.status(400).json({ email: "Email is already in use" });
      } else {
        console.log(err);
        return res.status(500).json({ general : "Somethig went wrong please try again" });
      }
    });
};

exports.login = (req, res) => {
  const user = {
    email: req.body.email,
    password: req.body.password,
  };

  const { valid, errors } = validateLoginData(user);
  if (!valid) return res.status(400).json(errors);

  firebase
    .auth()
    .signInWithEmailAndPassword(user.email, user.password)
    .then((data) => {
      return data.user.getIdToken();
    })
    .then((token) => {
      return res.json({ token });
    })
    .catch((err) => {
      if (err.code === "auth/wrong-password") {
        return res
          .status(403)
          .json({ general: "Wrong credentials, please try again" });
      }
      console.log(err);
      return res.status(500).json({ err });
    });
};

exports.uploadImage = (req, res) => {
  const BusBoy = require("busboy");
  const path = require("path");
  const os = require("os");
  const fs = require("fs");
  const busboy = new BusBoy({ headers: req.headers });

  let imageFileName;
  let imageToBeUploaded = {};

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    if (mimetype !== "image/png" || mimetype !== "image/jpeg") {
      return res.status(400).json({ error: "wrong file type" });
    }
    const imageExtendion = filename.split(".")[filename.split(".").length - 1];
    imageFileName = `${Math.round(
      Math.random() * 1000000000000
    )}.${imageExtendion}`;
    const filepath = path.join(os.tmpdir(), imageFileName);
    imageToBeUploaded = { filepath, mimetype };
    file.pipe(fs.createWriteStream(filepath));
  });
  busboy.on("finish", () => {
    admin
      .storage()
      .bucket()
      .upload(imageToBeUploaded.filepath, {
        resumable: false,
        metadata: {
          metadata: {
            contentType: imageToBeUploaded.mimetype,
          },
        },
      })
      .then(() => {
        const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${imageFileName}?alt=media`;
        return db.doc(`/users/${req.user.handle}`).update({ imageUrl });
      })
      .then(() => {
        res.json({ message: "image uploaded successfully" });
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ error: err.code });
      });
  });
  busboy.end(req.rawBody);
};

//add user details
exports.addUserDetails = (req, res) => {
  let userDetails = reduceUserDetails(req.body);

  db.doc(`/users/${req.user.handle}`)
    .update(userDetails)
    .then(() => {
      res.json({ message: "details added successfully" });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err: err.code });
    });
};

exports.getAuthenticatedUser = (req, res) => {
  let userData = {};
  db.doc(`/users/${req.user.handle}`)
    .get()
    .then((doc) => {
      if (doc.exists) {
        userData.credentials = doc.data();
        return db
          .collection("likes")
          .where("userHandle", "==", req.user.handle)
          .get();
      }
    })
    .then((data) => {
      userData.likes = [];
      data.forEach((doc) => userData.likes.push(doc.data()));
      return db.collection("notifications").where("recipient", "==", req.user.handle)
      .orderBy("createdAt", "desc").limit(10).get();
    }).then(data => {
      userData.notifications = [];
      data.forEach(doc => {
        userData.notifications.push({
          recipient: doc.data().recipient,
          sender: doc.data().sender,
          read: doc.data().read,
          type: doc.data().type,
          screamId: doc.data().recipient,
          createdAt: doc.data().createdAt,
          notificationId: doc.id
        })
      });
      return res.json(userData);
    })
    .catch((err) => {
      console.error(err);
      return res.status(500).json({ error: err.code });
    });
};

exports.getUserDetails = (req, res) => {
  let userData = {};
  db.doc(`users/${req.params.handle}`).get()
  .then(doc => {
    if(doc.exists){
      userData.user = doc.data();
      return db.collection("screams").where("userHandle", "==", req.params.handle)
      .orderBy("createdAt", "desc").get()
    }else{
      res.status(404).json({error: "user not found"})
    }
  }).then(data => {
    userData.screams = [];
    data.forEach(doc => {
      userData.screams.push({
        ...doc.data(),
        screamId: doc.id
      })
    })
    return res.json(userData)
  }).catch(err => {
    console.log(err)
    res.status(500).json({error: err.code})
  })
}
exports.markNotificationsRead = (req, res) => {
  let batch = db.batch();

  req.body.forEach(notificationId => {
    const notification = db.doc(`/notifications/${notificationId}`);
    batch.update(notification, {read : true})
  })
  batch.commit()
  .then(() => {
    return res.json({message : "Notification marked read"})
  })
  .catch(err => {
    console.log(err)
    res.status(500).json({error: err.code});
  })
}