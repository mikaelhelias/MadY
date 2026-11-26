# ggplot2 reference: geom_boxplot — outliers hidden, points jittered on top
p <- ggplot(mpg, aes(class, hwy))
p + geom_boxplot(outlier.shape = NA) + geom_jitter(width = 0.2)
